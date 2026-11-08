import { and, desc, eq, max, sql } from "drizzle-orm";
import { z } from "zod";

import { createDatabase, type Database } from "@/db";
import { clients } from "@/db/schema/client";
import { collectionMethods } from "@/db/schema/collection-method";
import { documents } from "@/db/schema/document";
import { documentSeries } from "@/db/schema/document-series";
import { recurringCycles } from "@/db/schema/recurring-cycle";
import { recurringTemplates } from "@/db/schema/recurring-template";
import { ApiError } from "@/lib/api/errors";
import { decodeIdCursor, encodeIdCursor } from "@/lib/api/pagination";
import { createUuidV7 } from "@/lib/ids";
import { hasFeature, madridDate } from "@/lib/plan";
import {
  cycleDate,
  isFinished,
  nextRunOn,
  type RecurrenceRule,
} from "@/lib/recurrence";
import { type CompanyContext, ResourceNotFoundError } from "@/services/context";
import { requireFeature } from "@/services/entitlements";

const decimal = z.union([z.string(), z.number()]).transform(String);

/** Same fields as a draft line (snake_case, amounts in cents). */
export const templateLineSchema = z
  .object({
    description: z.string().trim().min(1).max(1_000),
    quantity: decimal,
    unit_price_cents: z.number().int().min(0).max(2_147_483_647),
    tax_rate: decimal,
    tax_name: z.string().trim().min(1).max(30).optional(),
    discount_pct: decimal.optional(),
    unit: z.string().trim().max(20).nullable().optional(),
    tax_rate_id: z.string().uuid().nullable().optional(),
    catalog_item_id: z.string().uuid().nullable().optional(),
  })
  .strict();
export type TemplateLine = z.infer<typeof templateLineSchema>;

const templateFields = {
  client_id: z.string().uuid(),
  series_id: z.string().uuid().nullable().optional(),
  collection_method_id: z.string().uuid().nullable().optional(),
  lines: z.array(templateLineSchema).min(1).max(100),
  notes: z.string().trim().max(5_000).nullable().optional(),
  due_days: z.number().int().min(0).max(3_650).default(30),
  frequency: z.enum([
    "weekly",
    "monthly",
    "quarterly",
    "semiannual",
    "annual",
    "custom",
  ]),
  interval_count: z.number().int().min(1).max(365).nullable().optional(),
  interval_unit: z.enum(["day", "week", "month"]).nullable().optional(),
  start_on: z.iso.date(),
  end_on: z.iso.date().nullable().optional(),
  max_cycles: z.number().int().min(1).max(1_000).nullable().optional(),
  action: z.enum(["draft", "issue", "issue_and_send"]).default("draft"),
};

function checkRule(
  value: {
    frequency: string;
    interval_count?: number | null;
    interval_unit?: string | null;
    start_on?: string;
    end_on?: string | null;
    max_cycles?: number | null;
  },
  context: z.RefinementCtx,
): void {
  if (
    value.frequency === "custom" &&
    (!value.interval_count || !value.interval_unit)
  ) {
    context.addIssue({
      code: "custom",
      path: ["interval_count"],
      message: "Indica cada cuántos días, semanas o meses se repite.",
    });
  }
  if (value.end_on != null && value.max_cycles != null) {
    context.addIssue({
      code: "custom",
      path: ["end_on"],
      message: "Elige un final por fecha o por número de ciclos, no ambos.",
    });
  }
  if (value.end_on != null && value.start_on && value.end_on < value.start_on) {
    context.addIssue({
      code: "custom",
      path: ["end_on"],
      message: "El final no puede ser anterior al inicio.",
    });
  }
}

export const createTemplateSchema = z
  .object(templateFields)
  .strict()
  .superRefine(checkRule);

export const updateTemplateSchema = z
  .object({
    ...Object.fromEntries(
      Object.entries(templateFields).map(([key, schema]) => [
        key,
        (schema as z.ZodType).optional(),
      ]),
    ),
    status: z.enum(["active", "paused", "finished"]).optional(),
  } as { [K in keyof typeof templateFields]: z.ZodOptional<z.ZodType> } & {
    status: z.ZodOptional<
      z.ZodEnum<{ active: "active"; paused: "paused"; finished: "finished" }>
    >;
  })
  .strict()
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    {
      message: "Indica al menos un dato para actualizar.",
    },
  );

type TemplateRow = typeof recurringTemplates.$inferSelect;

export function ruleOf(row: TemplateRow): RecurrenceRule {
  return {
    frequency: row.frequency,
    intervalCount: row.intervalCount,
    intervalUnit: row.intervalUnit,
    startOn: row.startOn,
    endOn: row.endOn,
    maxCycles: row.maxCycles,
  };
}

/** Cycles claimed so far = index of the next cycle. */
export async function generatedCycles(
  database: Database,
  templateId: string,
): Promise<number> {
  const [row] = await database
    .select({ last: max(recurringCycles.cycleIndex) })
    .from(recurringCycles)
    .where(eq(recurringCycles.templateId, templateId));
  return row?.last === null || row?.last === undefined ? 0 : row.last + 1;
}

async function assertReferences(
  database: Database,
  companyId: string,
  input: {
    client_id?: string;
    series_id?: string | null;
    collection_method_id?: string | null;
  },
): Promise<void> {
  if (input.client_id) {
    const [client] = await database
      .select({ archivedAt: clients.archivedAt })
      .from(clients)
      .where(
        and(eq(clients.id, input.client_id), eq(clients.companyId, companyId)),
      );
    if (!client) {
      throw new ResourceNotFoundError();
    }
    if (client.archivedAt) {
      throw new ApiError(
        "validation_error",
        400,
        "El cliente está archivado. Elige un cliente activo.",
        { client_id: "Elige un cliente activo." },
      );
    }
  }
  if (input.series_id) {
    const [series] = await database
      .select({ type: documentSeries.documentType })
      .from(documentSeries)
      .where(
        and(
          eq(documentSeries.id, input.series_id),
          eq(documentSeries.companyId, companyId),
        ),
      );
    if (!series) {
      throw new ResourceNotFoundError();
    }
    if (series.type !== "invoice") {
      throw new ApiError(
        "validation_error",
        400,
        "Las recurrencias usan una serie de facturas.",
        { series_id: "Elige una serie de facturas." },
      );
    }
  }
  if (input.collection_method_id) {
    const [method] = await database
      .select({ id: collectionMethods.id })
      .from(collectionMethods)
      .where(
        and(
          eq(collectionMethods.id, input.collection_method_id),
          eq(collectionMethods.companyId, companyId),
        ),
      );
    if (!method) {
      throw new ResourceNotFoundError();
    }
  }
}

async function assertActionAllowed(
  database: Database,
  context: CompanyContext,
  action: string,
  clientId: string,
): Promise<void> {
  if (action !== "issue_and_send") {
    return;
  }
  if (!hasFeature(context.plan, "email")) {
    throw new ApiError(
      "feature_not_in_plan",
      403,
      "Enviar por email no está incluido en tu plan.",
      undefined,
      { feature: "email", required_plan: "essential" },
    );
  }
  const [client] = await database
    .select({ email: clients.email })
    .from(clients)
    .where(
      and(eq(clients.id, clientId), eq(clients.companyId, context.companyId)),
    );
  if (!client?.email) {
    throw new ApiError(
      "validation_error",
      400,
      "Para emitir y enviar, el cliente necesita un email.",
      { action: "El cliente no tiene email." },
    );
  }
}

export async function createTemplate(input: {
  database?: Database;
  context: CompanyContext;
  data: z.output<typeof createTemplateSchema>;
  now?: Date;
}): Promise<TemplateRow> {
  requireFeature(input.context, "recurring");
  const database = input.database ?? createDatabase();
  const now = input.now ?? new Date();
  const { data } = input;
  if (data.start_on < madridDate(now)) {
    throw new ApiError(
      "validation_error",
      400,
      "La fecha de inicio no puede estar en el pasado.",
      { start_on: "Elige hoy o una fecha futura." },
    );
  }
  await assertReferences(database, input.context.companyId, data);
  await assertActionAllowed(
    database,
    input.context,
    data.action,
    data.client_id,
  );

  const rule: RecurrenceRule = {
    frequency: data.frequency,
    intervalCount: data.interval_count,
    intervalUnit: data.interval_unit,
    startOn: data.start_on,
    endOn: data.end_on,
    maxCycles: data.max_cycles,
  };
  const [created] = await database
    .insert(recurringTemplates)
    .values({
      id: createUuidV7(now.getTime()),
      companyId: input.context.companyId,
      clientId: data.client_id,
      seriesId: data.series_id ?? null,
      collectionMethodId: data.collection_method_id ?? null,
      lines: data.lines,
      notes: data.notes ?? null,
      dueDays: data.due_days,
      frequency: data.frequency,
      intervalCount: data.interval_count ?? 1,
      intervalUnit: data.interval_unit ?? null,
      startOn: data.start_on,
      endOn: data.end_on ?? null,
      maxCycles: data.max_cycles ?? null,
      action: data.action,
      nextRunOn: nextRunOn(rule, 0),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!created) {
    throw new Error("No se ha podido crear la plantilla.");
  }
  return created;
}

export async function getTemplate(
  database: Database,
  companyId: string,
  templateId: string,
): Promise<TemplateRow> {
  const [row] = await database
    .select()
    .from(recurringTemplates)
    .where(
      and(
        eq(recurringTemplates.id, templateId),
        eq(recurringTemplates.companyId, companyId),
      ),
    );
  if (!row) {
    throw new ResourceNotFoundError();
  }
  return row;
}

export async function listTemplates(input: {
  database?: Database;
  companyId: string;
  limit: number;
  cursor?: string;
}): Promise<{ items: TemplateRow[]; nextCursor: string | null }> {
  const database = input.database ?? createDatabase();
  const afterId = decodeIdCursor(input.cursor);
  const rows = await database
    .select()
    .from(recurringTemplates)
    .where(
      and(
        eq(recurringTemplates.companyId, input.companyId),
        afterId ? sql`${recurringTemplates.id} < ${afterId}::uuid` : undefined,
      ),
    )
    .orderBy(desc(recurringTemplates.id))
    .limit(input.limit + 1);
  const items = rows.slice(0, input.limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > input.limit && last ? encodeIdCursor(last.id) : null,
  };
}

/**
 * Edits and status changes (FR-040). Content edits bump `version` and only
 * shape cycles claimed afterwards; pausing stops the planner; resuming skips
 * the cycles that fell due while paused instead of billing them in bulk;
 * finishing is final.
 */
export async function updateTemplate(input: {
  database?: Database;
  context: CompanyContext;
  templateId: string;
  data: z.output<typeof updateTemplateSchema>;
  now?: Date;
}): Promise<TemplateRow> {
  requireFeature(input.context, "recurring");
  const database = input.database ?? createDatabase();
  const now = input.now ?? new Date();
  const current = await getTemplate(
    database,
    input.context.companyId,
    input.templateId,
  );
  const data = input.data as Record<string, unknown>;
  if (current.status === "finished") {
    throw new ApiError("conflict", 409, "La recurrencia ya está finalizada.");
  }

  const contentKeys = Object.keys(data).filter((key) => key !== "status");
  const merged = {
    client_id: (data.client_id as string | undefined) ?? current.clientId,
    series_id:
      data.series_id !== undefined
        ? (data.series_id as string | null)
        : current.seriesId,
    collection_method_id:
      data.collection_method_id !== undefined
        ? (data.collection_method_id as string | null)
        : current.collectionMethodId,
    action: (data.action as string | undefined) ?? current.action,
  };
  if (contentKeys.length > 0) {
    await assertReferences(database, input.context.companyId, {
      client_id: data.client_id as string | undefined,
      series_id: data.series_id as string | null | undefined,
      collection_method_id: data.collection_method_id as
        | string
        | null
        | undefined,
    });
    await assertActionAllowed(
      database,
      input.context,
      merged.action,
      merged.client_id,
    );
  }

  const rule: RecurrenceRule = {
    frequency:
      (data.frequency as RecurrenceRule["frequency"]) ?? current.frequency,
    intervalCount:
      data.interval_count !== undefined
        ? (data.interval_count as number | null)
        : current.intervalCount,
    intervalUnit:
      data.interval_unit !== undefined
        ? (data.interval_unit as RecurrenceRule["intervalUnit"])
        : current.intervalUnit,
    startOn: current.startOn,
    endOn:
      data.end_on !== undefined
        ? (data.end_on as string | null)
        : current.endOn,
    maxCycles:
      data.max_cycles !== undefined
        ? (data.max_cycles as number | null)
        : current.maxCycles,
  };
  if (rule.endOn != null && rule.maxCycles != null) {
    throw new ApiError(
      "validation_error",
      400,
      "Elige un final por fecha o por número de ciclos, no ambos.",
    );
  }
  if (data.start_on !== undefined && data.start_on !== current.startOn) {
    throw new ApiError(
      "validation_error",
      400,
      "El inicio no se puede cambiar: crea una recurrencia nueva.",
      { start_on: "El inicio no es editable." },
    );
  }

  let generated = await generatedCycles(database, current.id);
  let status =
    (data.status as TemplateRow["status"] | undefined) ?? current.status;
  const today = madridDate(now);

  if (current.status === "paused" && status === "active") {
    // Skip what fell due while paused, one skipped cycle per missed date.
    for (;;) {
      const due = nextRunOn(rule, generated);
      if (due === null || due >= today) {
        break;
      }
      await database
        .insert(recurringCycles)
        .values({
          id: createUuidV7(now.getTime()),
          companyId: current.companyId,
          templateId: current.id,
          cycleIndex: generated,
          scheduledOn: due,
          templateVersion: current.version,
          outcome: "skipped_plan",
          reasonCode: "paused",
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
      generated += 1;
    }
  }
  const finished = status === "finished" || isFinished(rule, generated);
  if (finished) {
    status = "finished";
  }

  const [updated] = await database
    .update(recurringTemplates)
    .set({
      ...(data.client_id !== undefined
        ? { clientId: data.client_id as string }
        : {}),
      ...(data.series_id !== undefined
        ? { seriesId: data.series_id as string | null }
        : {}),
      ...(data.collection_method_id !== undefined
        ? { collectionMethodId: data.collection_method_id as string | null }
        : {}),
      ...(data.lines !== undefined ? { lines: data.lines } : {}),
      ...(data.notes !== undefined
        ? { notes: data.notes as string | null }
        : {}),
      ...(data.due_days !== undefined
        ? { dueDays: data.due_days as number }
        : {}),
      ...(data.frequency !== undefined ? { frequency: rule.frequency } : {}),
      ...(data.interval_count !== undefined || data.frequency !== undefined
        ? { intervalCount: rule.intervalCount ?? 1 }
        : {}),
      ...(data.interval_unit !== undefined || data.frequency !== undefined
        ? { intervalUnit: rule.intervalUnit ?? null }
        : {}),
      endOn: rule.endOn ?? null,
      maxCycles: rule.maxCycles ?? null,
      ...(data.action !== undefined
        ? { action: data.action as TemplateRow["action"] }
        : {}),
      status,
      nextRunOn: finished ? null : nextRunOn(rule, generated),
      version: contentKeys.length > 0 ? current.version + 1 : current.version,
      updatedAt: now,
    })
    .where(
      and(
        eq(recurringTemplates.id, current.id),
        eq(recurringTemplates.companyId, current.companyId),
      ),
    )
    .returning();
  if (!updated) {
    throw new ResourceNotFoundError();
  }
  return updated;
}

export async function listCycles(input: {
  database?: Database;
  companyId: string;
  templateId: string;
  limit: number;
  cursor?: string;
}) {
  const database = input.database ?? createDatabase();
  await getTemplate(database, input.companyId, input.templateId);
  const afterId = decodeIdCursor(input.cursor);
  const rows = await database
    .select({
      id: recurringCycles.id,
      cycleIndex: recurringCycles.cycleIndex,
      scheduledOn: recurringCycles.scheduledOn,
      templateVersion: recurringCycles.templateVersion,
      outcome: recurringCycles.outcome,
      reasonCode: recurringCycles.reasonCode,
      documentId: documents.id,
      documentNumber: documents.fullNumber,
    })
    .from(recurringCycles)
    .leftJoin(documents, eq(documents.recurringCycleId, recurringCycles.id))
    .where(
      and(
        eq(recurringCycles.templateId, input.templateId),
        eq(recurringCycles.companyId, input.companyId),
        afterId ? sql`${recurringCycles.id} < ${afterId}::uuid` : undefined,
      ),
    )
    .orderBy(desc(recurringCycles.id))
    .limit(input.limit + 1);
  const items = rows.slice(0, input.limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > input.limit && last ? encodeIdCursor(last.id) : null,
  };
}

export { cycleDate };

import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { createDatabase, type Database } from "@/db";
import { accessEvents } from "@/db/schema/access-event";
import { clients } from "@/db/schema/client";
import { companies } from "@/db/schema/company";
import { documents } from "@/db/schema/document";
import { exportJobs } from "@/db/schema/export-job";
import { payments } from "@/db/schema/payment";
import { ApiError } from "@/lib/api/errors";
import { decodeIdCursor, encodeIdCursor } from "@/lib/api/pagination";
import {
  DOWNLOAD_TOKEN_TTL_MS,
  deriveSignedToken,
  exportTokenSeed,
} from "@/lib/download-tokens";
import { type ExportFile, exportFilesSchema } from "@/lib/exports/files";
import {
  EXPORT_PERIODS,
  type PeriodBounds,
  resolvePeriod,
} from "@/lib/exports/period";
import {
  buildPeriodSheet,
  type PeriodSheetDocument,
} from "@/lib/exports/period-sheet";
import { writeWorkbook, XLSX_CONTENT_TYPE } from "@/lib/exports/xlsx";
import { createUuidV7 } from "@/lib/ids";
import { derivePaymentStatus, type PaymentStatus } from "@/lib/payments";
import { DOCUMENT_TYPES, type DocumentType, madridDate } from "@/lib/plan";
import {
  type CompanyContext,
  ResourceNotFoundError,
  readOnlyAccessError,
} from "@/services/context";
import type { EmailQueue } from "@/services/email/auth-deliveries";
import { enqueueEmail } from "@/services/email/notices";
import { requireFeature } from "@/services/entitlements";
import { createNotification } from "@/services/notifications";
import { type PrivateBucket, pdfObjectKey } from "@/services/storage";
import {
  createExportBuildMessage,
  createPdfRenderMessage,
} from "@/workers/messages";
import { RetryableQueueError } from "@/workers/queue-consumer";

import { writePdfZip, type ZipEntry } from "./zip";

export interface JobsQueue {
  send(message: unknown): Promise<void>;
}

const PAYMENT_FILTERS = ["pending", "partial", "paid", "overdue"] as const;
/** A ZIP waits this long for missing PDFs before failing visibly. */
const PDF_WAIT_LIMIT_MS = 30 * 60 * 1_000;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, "Usa el formato AAAA-MM-DD.");

export const createExportSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("period_excel"),
      period: z.enum(EXPORT_PERIODS),
      send_to_advisor: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("advanced"),
      types: z.array(z.enum(DOCUMENT_TYPES)).min(1).max(DOCUMENT_TYPES.length),
      from: isoDate,
      to: isoDate,
      status: z.enum(["issued", "voided", ...PAYMENT_FILTERS]).optional(),
      client_id: z.string().uuid().optional(),
      formats: z
        .array(z.enum(["xlsx", "pdf_zip"]))
        .min(1)
        .max(2),
    })
    .strict()
    .refine((value) => value.from <= value.to, {
      message: "La fecha inicial no puede ser posterior a la final.",
      path: ["from"],
    }),
]);
export type CreateExportInput = z.infer<typeof createExportSchema>;

/** Stored in `export_job.filters`. */
export interface ExportFilters {
  types: DocumentType[];
  from: string;
  to: string;
  status?: string;
  client_id?: string;
  period_label?: string;
}

function requesterOf(context: CompanyContext): string {
  return `${context.role === "advisor" ? "advisor" : "user"}:${context.userId}`;
}

/**
 * Starts an export (FR-032, FR-033). Advisors may export (read access) but
 * never send to the advisor email; every advisor export is audited.
 */
export async function createExport(input: {
  database?: Database;
  queue: JobsQueue;
  context: CompanyContext;
  request: CreateExportInput;
  now?: Date;
}): Promise<{ id: string }> {
  const database = input.database ?? createDatabase();
  const now = input.now ?? new Date();
  const { context, request } = input;

  let filters: ExportFilters;
  let formats: Array<"xlsx" | "pdf_zip">;
  let periodKey: string | null = null;
  let sendToAdvisor = false;

  if (request.kind === "period_excel") {
    requireFeature(context, "period_export");
    const period = resolvePeriod(request.period, now);
    filters = {
      types: ["invoice"],
      from: period.from,
      to: period.to,
      period_label: period.label,
    };
    formats = ["xlsx"];
    periodKey = period.key;
    if (request.send_to_advisor) {
      if (context.role !== "owner") {
        throw readOnlyAccessError();
      }
      const [company] = await database
        .select({ advisorEmail: companies.advisorEmail })
        .from(companies)
        .where(eq(companies.id, context.companyId));
      if (!company?.advisorEmail) {
        throw new ApiError(
          "validation_error",
          400,
          "Indica primero el email de tu asesoría en Configuración.",
          { advisor_email: "Falta el email de tu asesoría." },
        );
      }
      sendToAdvisor = true;
    }
  } else {
    requireFeature(context, "advanced_export");
    if (request.client_id) {
      const [client] = await database
        .select({ id: clients.id })
        .from(clients)
        .where(
          and(
            eq(clients.id, request.client_id),
            eq(clients.companyId, context.companyId),
          ),
        );
      if (!client) {
        throw new ResourceNotFoundError();
      }
    }
    filters = {
      types: request.types,
      from: request.from,
      to: request.to,
      ...(request.status ? { status: request.status } : {}),
      ...(request.client_id ? { client_id: request.client_id } : {}),
    };
    formats = request.formats;
  }

  const id = createUuidV7(now.getTime());
  await database.insert(exportJobs).values({
    id,
    companyId: context.companyId,
    requestedBy: requesterOf(context),
    kind: request.kind,
    filters,
    formats,
    periodKey,
    sendToAdvisor,
    createdAt: now,
    updatedAt: now,
  });
  if (context.role === "advisor") {
    await database.insert(accessEvents).values({
      id: createUuidV7(now.getTime()),
      companyId: context.companyId,
      actorUserId: context.userId,
      action: "exported",
      targetId: id,
      createdAt: now,
    });
  }
  await input.queue.send(createExportBuildMessage(id, now));
  return { id };
}

/** Scheduled send (FR-034): one system job per company and period. */
export async function createScheduledExport(input: {
  database: Database;
  queue: JobsQueue;
  companyId: string;
  period: PeriodBounds;
  formats: Array<"xlsx" | "pdf_zip">;
  now: Date;
}): Promise<string | null> {
  const id = createUuidV7(input.now.getTime());
  const [created] = await input.database
    .insert(exportJobs)
    .values({
      id,
      companyId: input.companyId,
      requestedBy: "system",
      kind: "period_excel",
      filters: {
        types: ["invoice"],
        from: input.period.from,
        to: input.period.to,
        period_label: input.period.label,
      } satisfies ExportFilters,
      formats: input.formats,
      periodKey: input.period.key,
      sendToAdvisor: true,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing()
    .returning({ id: exportJobs.id });
  if (created) {
    await input.queue.send(createExportBuildMessage(created.id, input.now));
  }
  return created?.id ?? null;
}

// ------------------------------------------------------------- read side ---

export interface ExportView {
  id: string;
  kind: "period_excel" | "advanced";
  status: "queued" | "running" | "ready" | "empty" | "failed";
  periodLabel: string | null;
  filters: ExportFilters;
  formats: string[];
  sendToAdvisor: boolean;
  requestedBy: string;
  files: Array<{ filename: string; url: string }>;
  expiresAt: Date | null;
  createdAt: Date;
}

async function toView(
  row: typeof exportJobs.$inferSelect,
  links: { appBaseUrl: string; secret: string; now: Date },
): Promise<ExportView> {
  const filters = row.filters as ExportFilters;
  const files = exportFilesSchema.safeParse(row.fileKeys);
  const downloadable =
    row.status === "ready" &&
    row.expiresAt !== null &&
    row.expiresAt > links.now &&
    files.success;
  let urls: ExportView["files"] = [];
  if (downloadable && files.success) {
    const { token } = await deriveSignedToken(
      links.secret,
      exportTokenSeed(row.id),
    );
    urls = files.data.map((file, index) => ({
      filename: file.filename,
      url: new URL(
        `/x/${token}${index > 0 ? `?f=${index}` : ""}`,
        links.appBaseUrl,
      ).toString(),
    }));
  }
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    periodLabel: filters.period_label ?? null,
    filters,
    formats: row.formats,
    sendToAdvisor: row.sendToAdvisor,
    requestedBy: row.requestedBy,
    files: urls,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

export async function getExport(input: {
  database?: Database;
  companyId: string;
  exportId: string;
  appBaseUrl: string;
  secret: string;
  now?: Date;
}): Promise<ExportView> {
  const database = input.database ?? createDatabase();
  const [row] = await database
    .select()
    .from(exportJobs)
    .where(
      and(
        eq(exportJobs.id, input.exportId),
        eq(exportJobs.companyId, input.companyId),
      ),
    );
  if (!row) {
    throw new ResourceNotFoundError();
  }
  return toView(row, { ...input, now: input.now ?? new Date() });
}

export async function listExports(input: {
  database?: Database;
  companyId: string;
  limit: number;
  cursor?: string;
  appBaseUrl: string;
  secret: string;
  now?: Date;
}): Promise<{ items: ExportView[]; nextCursor: string | null }> {
  const database = input.database ?? createDatabase();
  const afterId = decodeIdCursor(input.cursor);
  const rows = await database
    .select()
    .from(exportJobs)
    .where(
      and(
        eq(exportJobs.companyId, input.companyId),
        afterId ? lt(exportJobs.id, afterId) : undefined,
      ),
    )
    .orderBy(desc(exportJobs.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const now = input.now ?? new Date();
  const last = page.at(-1);
  return {
    items: await Promise.all(page.map((row) => toView(row, { ...input, now }))),
    nextCursor:
      rows.length > input.limit && last ? encodeIdCursor(last.id) : null,
  };
}

// ----------------------------------------------------------------- build ---

interface ExportDocumentRow {
  id: string;
  documentType: DocumentType;
  fullNumber: string | null;
  issueDate: string;
  dueDate: string | null;
  status: "draft" | "issued" | "voided";
  clientSnapshot: unknown;
  subtotalCents: number;
  taxBreakdown: unknown;
  retentionCents: number;
  totalCents: number;
  pdfStatus: "pending" | "ready" | "failed" | null;
  paidCents: number;
}

async function loadExportDocuments(
  database: Database,
  companyId: string,
  filters: ExportFilters,
): Promise<ExportDocumentRow[]> {
  const paid = database
    .select({
      documentId: payments.documentId,
      paidCents: sql<number>`sum(${payments.amountCents})::integer`.as(
        "paid_cents",
      ),
    })
    .from(payments)
    .groupBy(payments.documentId)
    .as("paid");
  const rows = await database
    .select({
      id: documents.id,
      documentType: documents.documentType,
      fullNumber: documents.fullNumber,
      issueDate: documents.issueDate,
      dueDate: documents.dueDate,
      status: documents.status,
      clientSnapshot: documents.clientSnapshot,
      subtotalCents: documents.subtotalCents,
      taxBreakdown: documents.taxBreakdown,
      retentionCents: documents.retentionCents,
      totalCents: documents.totalCents,
      pdfStatus: documents.pdfStatus,
      paidCents: sql<number>`coalesce(${paid.paidCents}, 0)::integer`,
    })
    .from(documents)
    .leftJoin(paid, eq(paid.documentId, documents.id))
    .where(
      and(
        eq(documents.companyId, companyId),
        inArray(documents.documentType, filters.types),
        inArray(documents.status, ["issued", "voided"]),
        gte(documents.issueDate, filters.from),
        lte(documents.issueDate, filters.to),
        filters.client_id
          ? eq(documents.clientId, filters.client_id)
          : undefined,
        filters.status === "issued" || filters.status === "voided"
          ? eq(documents.status, filters.status)
          : undefined,
      ),
    )
    .orderBy(asc(documents.issueDate), asc(documents.fullNumber));
  return rows as ExportDocumentRow[];
}

function paymentStatusOf(
  row: ExportDocumentRow,
  today: string,
): PaymentStatus | null {
  return derivePaymentStatus({
    documentStatus: row.status,
    documentType: row.documentType,
    totalCents: row.totalCents,
    paidCents: row.paidCents,
    dueDate: row.dueDate,
    today,
  });
}

function sheetDocument(
  row: ExportDocumentRow,
  paymentStatus: PaymentStatus | null,
): PeriodSheetDocument {
  const client = (row.clientSnapshot ?? {}) as {
    name?: string;
    taxId?: string | null;
  };
  return {
    documentType: row.documentType,
    fullNumber: row.fullNumber ?? "",
    issueDate: row.issueDate,
    status: row.status === "voided" ? "voided" : "issued",
    clientName: client.name ?? "",
    clientTaxId: client.taxId ?? null,
    subtotalCents: row.subtotalCents,
    taxBreakdown: row.taxBreakdown as PeriodSheetDocument["taxBreakdown"],
    retentionCents: row.retentionCents,
    totalCents: row.totalCents,
    paymentStatus,
  };
}

function safeName(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "documento"
  );
}

export interface ExportBuildDependencies {
  database?: Database;
  bucket: PrivateBucket;
  pdfQueue: JobsQueue;
  emailQueue: EmailQueue;
  secret: string;
  now?: Date;
}

/**
 * `export.build`: XLSX and/or ZIP of the cached PDFs, then a 7-day link.
 * PDFs that are not ready yet are (re)queued and the job retries, so the
 * ZIP always contains every document.
 */
export async function buildExport(
  exportId: string,
  dependencies: ExportBuildDependencies,
): Promise<void> {
  const database = dependencies.database ?? createDatabase();
  const now = dependencies.now ?? new Date();
  const [job] = await database
    .update(exportJobs)
    .set({ status: "running", updatedAt: now })
    .where(
      and(
        eq(exportJobs.id, exportId),
        inArray(exportJobs.status, ["queued", "running"]),
      ),
    )
    .returning();
  if (!job) {
    return;
  }
  const filters = job.filters as ExportFilters;
  const today = madridDate(now);
  const rows = (
    await loadExportDocuments(database, job.companyId, filters)
  ).filter((row) => {
    if (!filters.status || ["issued", "voided"].includes(filters.status)) {
      return true;
    }
    return paymentStatusOf(row, today) === filters.status;
  });

  if (rows.length === 0) {
    await database
      .update(exportJobs)
      .set({ status: "empty", updatedAt: now })
      .where(eq(exportJobs.id, job.id));
    return;
  }

  const baseName = safeName(
    filters.period_label
      ? `facturas-${job.periodKey ?? filters.period_label}`
      : `exportacion-${filters.from}-${filters.to}`,
  );
  const files: ExportFile[] = [];

  if (job.formats.includes("pdf_zip")) {
    const missing = rows.filter((row) => row.pdfStatus !== "ready");
    if (
      missing.length > 0 &&
      now.getTime() - job.createdAt.getTime() > PDF_WAIT_LIMIT_MS
    ) {
      await failExport(database, job.id, now);
      await createNotification({
        database,
        companyId: job.companyId,
        userId: job.requestedBy.split(":")[1],
        kind: "export_failed",
        payload: { export_id: job.id },
        idempotencyKey: `export_failed:${job.id}`,
        now,
      });
      return;
    }
    if (missing.length > 0) {
      for (const row of missing.filter(
        (item) => item.pdfStatus !== "pending",
      )) {
        await database
          .update(documents)
          .set({ pdfStatus: "pending" })
          .where(eq(documents.id, row.id));
        await dependencies.pdfQueue.send(createPdfRenderMessage(row.id));
      }
      throw new RetryableQueueError(
        `${missing.length} PDF todavía no están listos.`,
      );
    }
  }

  if (job.formats.includes("xlsx")) {
    const sheet = buildPeriodSheet(
      rows.map((row) => sheetDocument(row, paymentStatusOf(row, today))),
    );
    const key = `exports/${job.companyId}/${job.id}-${baseName}.xlsx`;
    await dependencies.bucket.put(
      key,
      writeWorkbook([
        { name: "Documentos", rows: sheet.rows, moneyCells: sheet.moneyCells },
      ]),
      { httpMetadata: { contentType: XLSX_CONTENT_TYPE } },
    );
    files.push({
      key,
      filename: `${baseName}.xlsx`,
      content_type: XLSX_CONTENT_TYPE,
    });
  }

  if (job.formats.includes("pdf_zip")) {
    const key = `exports/${job.companyId}/${job.id}-${baseName}.zip`;
    const bucket = dependencies.bucket;
    async function* entries(): AsyncGenerator<ZipEntry> {
      for (const row of rows) {
        const object = await bucket.get(pdfObjectKey(row.id));
        if (!object) {
          throw new RetryableQueueError("Falta un PDF en el almacenamiento.");
        }
        yield {
          name: `${safeName(row.fullNumber ?? row.id)}.pdf`,
          bytes: new Uint8Array(await new Response(object.body).arrayBuffer()),
        };
      }
    }
    await writePdfZip({ bucket, key, entries: entries() });
    files.push({
      key,
      filename: `${baseName}.zip`,
      content_type: "application/zip",
    });
  }

  const { hash } = await deriveSignedToken(
    dependencies.secret,
    exportTokenSeed(job.id),
  );
  const expiresAt = new Date(now.getTime() + DOWNLOAD_TOKEN_TTL_MS);
  const [ready] = await database
    .update(exportJobs)
    .set({
      status: "ready",
      fileKeys: files,
      downloadTokenHash: hash,
      expiresAt,
      updatedAt: now,
    })
    .where(and(eq(exportJobs.id, job.id), eq(exportJobs.status, "running")))
    .returning({ id: exportJobs.id });
  if (!ready) {
    return;
  }

  const [company] = await database
    .select({
      legalName: companies.legalName,
      advisorEmail: companies.advisorEmail,
      ownerId: companies.userId,
    })
    .from(companies)
    .where(eq(companies.id, job.companyId));
  if (job.sendToAdvisor && company?.advisorEmail) {
    await enqueueEmail({
      database,
      queue: dependencies.emailQueue,
      purpose: "advisor_export",
      template: "advisor_export",
      companyId: job.companyId,
      recipientEmail: company.advisorEmail,
      idempotencyKey: `advisor_export:${job.id}`,
      exportJobId: job.id,
      payload: {
        export_id: job.id,
        company_name: company.legalName ?? "Tu cliente",
        period_label: filters.period_label ?? null,
        expires_at: expiresAt.toISOString(),
      },
      now,
    });
  }
  const requester = job.requestedBy.split(":")[1];
  await createNotification({
    database,
    companyId: job.companyId,
    userId: requester ?? company?.ownerId,
    kind: "export_ready",
    payload: { export_id: job.id },
    idempotencyKey: `export_ready:${job.id}`,
    now,
  });
}

/** Marks a build as failed once retries are exhausted (DLQ path). */
export async function failExport(
  database: Database,
  exportId: string,
  now: Date,
): Promise<void> {
  await database
    .update(exportJobs)
    .set({ status: "failed", updatedAt: now })
    .where(eq(exportJobs.id, exportId));
}

import { and, eq } from "drizzle-orm";

import { createDatabase, type Database } from "@/db";
import { clients } from "@/db/schema/client";
import { companies } from "@/db/schema/company";
import { documents } from "@/db/schema/document";
import { documentEvents } from "@/db/schema/document-event";
import { recurringCycles } from "@/db/schema/recurring-cycle";
import { recurringTemplates } from "@/db/schema/recurring-template";
import { ApiError } from "@/lib/api/errors";
import { addCalendarDays } from "@/lib/dates";
import { createUuidV7 } from "@/lib/ids";
import { logSafe } from "@/lib/log";
import { hasFeature } from "@/lib/plan";
import {
  type IssueDocumentDependencies,
  issueDocument,
} from "@/services/document-issuance";
import { createDraftDocument } from "@/services/documents";
import type { EmailQueue } from "@/services/email/auth-deliveries";
import { createOrReuseDocumentEmailDelivery } from "@/services/email/deliveries";
import { createNotification } from "@/services/notifications";
import { createEmailSendMessage } from "@/workers/messages";

import type { TemplateLine } from "./templates";

export interface RunCycleDependencies {
  database?: Database;
  pdfQueue: IssueDocumentDependencies["queue"];
  emailQueue: EmailQueue;
  now?: Date;
}

type Outcome = (typeof recurringCycles.$inferSelect)["outcome"];

function isUniqueViolation(error: unknown): boolean {
  for (
    let current: unknown = error, depth = 0;
    current && depth < 4;
    current = (current as { cause?: unknown }).cause, depth += 1
  ) {
    const { code, message } = current as { code?: string; message?: string };
    if (code === "23505" || message?.includes("duplicate key")) {
      return true;
    }
  }
  return false;
}

function draftLines(lines: TemplateLine[]) {
  return lines.map((line) => ({
    description: line.description,
    quantity: line.quantity,
    unitPriceCents: line.unit_price_cents,
    taxRate: line.tax_rate,
    taxName: line.tax_name ?? "IVA",
    discountPercentage: line.discount_pct ?? "0",
    unit: line.unit ?? null,
    taxRateId: line.tax_rate_id ?? null,
    catalogItemId: line.catalog_item_id ?? null,
  }));
}

/**
 * `recurring.run` (FR-038, FR-039, SC-008): exactly one document per cycle.
 * The draft id derives from the cycle and `document.recurring_cycle_id` is
 * unique, so a redelivery finds the draft it already made; issuing goes
 * through the shared guard with the `recurring_cycle` strategy. A cycle that
 * cannot be issued stays a draft and the user is told.
 */
export async function runRecurringCycle(
  cycleId: string,
  dependencies: RunCycleDependencies,
): Promise<void> {
  const database = dependencies.database ?? createDatabase();
  const now = dependencies.now ?? new Date();

  const [cycle] = await database
    .select()
    .from(recurringCycles)
    .where(eq(recurringCycles.id, cycleId));
  if (!cycle || cycle.outcome !== "pending") {
    return;
  }
  const [template] = await database
    .select()
    .from(recurringTemplates)
    .where(eq(recurringTemplates.id, cycle.templateId));
  const [company] = await database
    .select({ plan: companies.plan, userId: companies.userId })
    .from(companies)
    .where(eq(companies.id, cycle.companyId));
  if (!template || !company) {
    return;
  }

  const setOutcome = async (outcome: Outcome, reasonCode: string | null) => {
    await database
      .update(recurringCycles)
      .set({ outcome, reasonCode, updatedAt: now })
      .where(
        and(
          eq(recurringCycles.id, cycle.id),
          eq(recurringCycles.outcome, "pending"),
        ),
      );
  };
  const notify = (
    kind: "recurring_generated" | "recurring_failed",
    documentId: string | null,
    documentNumber: string | null,
    critical: boolean,
  ) =>
    createNotification({
      database,
      companyId: cycle.companyId,
      kind,
      payload: {
        template_id: template.id,
        document_id: documentId,
        document_number: documentNumber,
      },
      idempotencyKey: `recurring_cycle:${cycle.id}:${kind}`,
      email: critical ? { queue: dependencies.emailQueue } : undefined,
      now,
    });

  if (!hasFeature(company.plan, "recurring")) {
    await setOutcome("skipped_plan", "plan");
    return;
  }

  const [client] = await database
    .select({ archivedAt: clients.archivedAt, email: clients.email })
    .from(clients)
    .where(
      and(
        eq(clients.id, template.clientId),
        eq(clients.companyId, cycle.companyId),
      ),
    );
  const clientUsable = Boolean(client) && client?.archivedAt === null;

  // The draft: reuse what a previous delivery made.
  let [draft] = await database
    .select({ id: documents.id, status: documents.status })
    .from(documents)
    .where(eq(documents.recurringCycleId, cycle.id));
  if (!draft) {
    const lines = template.lines as TemplateLine[];
    try {
      const created = await createDraftDocument(
        {
          companyId: cycle.companyId,
          actor: company.userId,
          documentType: "invoice",
          // An archived client cannot take new documents: keep the draft
          // without client so the user can fix it (FR-039).
          clientId: clientUsable ? template.clientId : null,
          seriesId: template.seriesId,
          collectionMethodId: template.collectionMethodId,
          issueDate: cycle.scheduledOn,
          dueDate: addCalendarDays(cycle.scheduledOn, template.dueDays),
          notes: template.notes,
          lines: draftLines(lines),
          recurringCycleId: cycle.id,
        },
        { database, now },
      );
      draft = { id: created.id, status: created.status };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      [draft] = await database
        .select({ id: documents.id, status: documents.status })
        .from(documents)
        .where(eq(documents.recurringCycleId, cycle.id));
    }
    if (draft) {
      await database.insert(documentEvents).values({
        id: createUuidV7(now.getTime()),
        companyId: cycle.companyId,
        documentId: draft.id,
        actor: "system:recurring",
        event: "recurring_generated",
        payload: { template_id: template.id, cycle_index: cycle.cycleIndex },
        createdAt: now,
      });
    }
  }
  if (!draft) {
    throw new Error("No se ha podido crear el borrador del ciclo.");
  }

  if (!clientUsable) {
    await setOutcome("failed", "client_archived");
    await notify("recurring_failed", draft.id, null, true);
    return;
  }
  if (template.action === "draft") {
    await setOutcome("draft_created", null);
    await notify("recurring_generated", draft.id, null, false);
    return;
  }

  let number: string | null = null;
  try {
    const issued = await issueDocument(
      {
        companyId: cycle.companyId,
        documentId: draft.id,
        actor: company.userId,
        idempotency: { kind: "recurring_cycle", cycleId: cycle.id },
      },
      { database, queue: dependencies.pdfQueue, now },
    );
    number = issued.fullNumber;
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error;
    }
    // Quota, incomplete company data… the draft stays for the user.
    logSafe("warn", "recurring.issue_blocked", { error_code: error.code });
    await setOutcome("failed", error.code);
    await notify("recurring_failed", draft.id, null, true);
    return;
  }

  if (template.action === "issue_and_send" && client?.email) {
    if (hasFeature(company.plan, "email")) {
      const delivery = await createOrReuseDocumentEmailDelivery({
        database,
        companyId: cycle.companyId,
        documentId: draft.id,
        requestedBy: company.userId,
        recipientEmail: client.email,
        customMessage: null,
        idempotencyKey: `recurring-cycle-${cycle.id}`,
        now,
      });
      await dependencies.emailQueue.send(createEmailSendMessage(delivery.id));
      await setOutcome("sent", null);
      await notify("recurring_generated", draft.id, number, false);
      return;
    }
  }
  await setOutcome("issued", null);
  await notify("recurring_generated", draft.id, number, false);
}

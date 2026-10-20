import { and, asc, eq, isNull } from "drizzle-orm";

import { createDatabase, type Database } from "@/db";
import { clients } from "@/db/schema/client";
import { companies } from "@/db/schema/company";
import { documents } from "@/db/schema/document";
import { paymentReminders } from "@/db/schema/payment-reminder";
import { ApiError } from "@/lib/api/errors";
import { type ReminderPolicy, reminderPolicySchema } from "@/lib/reminders";
import { type CompanyContext, ResourceNotFoundError } from "@/services/context";
import { requireFeature } from "@/services/entitlements";

/** `PUT /company` `reminder_policy` (Pro, FR-041). */
export async function saveReminderPolicy(
  context: CompanyContext,
  policy: ReminderPolicy,
  database: Database = createDatabase(),
): Promise<void> {
  requireFeature(context, "reminders");
  const parsed = reminderPolicySchema.safeParse(policy);
  if (!parsed.success) {
    throw new ApiError(
      "validation_error",
      400,
      parsed.error.issues[0]?.message ??
        "La política de recordatorios no es válida.",
    );
  }
  await database
    .update(companies)
    .set({ reminderPolicy: parsed.data, updatedAt: new Date() })
    .where(eq(companies.id, context.companyId));
}

/** Per-invoice opt-out (FR-041); allowed on issued invoices, not fiscal data. */
export async function setDocumentReminders(input: {
  database?: Database;
  companyId: string;
  documentId: string;
  enabled: boolean;
}): Promise<void> {
  const database = input.database ?? createDatabase();
  const [updated] = await database
    .update(documents)
    .set({ remindersEnabled: input.enabled })
    .where(
      and(
        eq(documents.id, input.documentId),
        eq(documents.companyId, input.companyId),
        eq(documents.documentType, "invoice"),
        isNull(documents.deletedAt),
      ),
    )
    .returning({ id: documents.id });
  if (!updated) {
    throw new ResourceNotFoundError();
  }
}

export async function setClientReminders(input: {
  database?: Database;
  companyId: string;
  clientId: string;
  enabled: boolean;
}): Promise<void> {
  const database = input.database ?? createDatabase();
  const [updated] = await database
    .update(clients)
    .set({ remindersEnabled: input.enabled, updatedAt: new Date() })
    .where(
      and(
        eq(clients.id, input.clientId),
        eq(clients.companyId, input.companyId),
      ),
    )
    .returning({ id: clients.id });
  if (!updated) {
    throw new ResourceNotFoundError();
  }
}

export async function listDocumentReminders(input: {
  database?: Database;
  companyId: string;
  documentId: string;
}) {
  const database = input.database ?? createDatabase();
  const [document] = await database
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.id, input.documentId),
        eq(documents.companyId, input.companyId),
        isNull(documents.deletedAt),
      ),
    );
  if (!document) {
    throw new ResourceNotFoundError();
  }
  return database
    .select({
      id: paymentReminders.id,
      sequence: paymentReminders.sequence,
      scheduledOn: paymentReminders.scheduledOn,
      outcome: paymentReminders.outcome,
    })
    .from(paymentReminders)
    .where(
      and(
        eq(paymentReminders.documentId, input.documentId),
        eq(paymentReminders.companyId, input.companyId),
      ),
    )
    .orderBy(asc(paymentReminders.sequence));
}

/** The invoice's reminders cannot be sent: tell the user why (FR-042). */
export function reminderWarning(input: {
  clientEmail: string | null | undefined;
  clientReminders: boolean | undefined;
  documentReminders: boolean;
}): "client_without_email" | "client_opted_out" | "document_opted_out" | null {
  if (!input.documentReminders) {
    return "document_opted_out";
  }
  if (input.clientReminders === false) {
    return "client_opted_out";
  }
  if (!input.clientEmail?.trim()) {
    return "client_without_email";
  }
  return null;
}

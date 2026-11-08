import { and, eq, sql } from "drizzle-orm";

import { createDatabase, type Database } from "@/db";
import { clients } from "@/db/schema/client";
import { documents } from "@/db/schema/document";
import { documentEvents } from "@/db/schema/document-event";
import { emailDeliveries } from "@/db/schema/email-delivery";
import { payments } from "@/db/schema/payment";
import { paymentReminders } from "@/db/schema/payment-reminder";
import { shareLinks } from "@/db/schema/share-link";
import { createUuidV7 } from "@/lib/ids";
import type { EmailQueue } from "@/services/email/auth-deliveries";
import { enqueueEmail } from "@/services/email/notices";
import { createOrReactivateShareLink } from "@/services/share-links";

export interface ReminderRunDependencies {
  database?: Database;
  emailQueue: EmailQueue;
  now?: Date;
}

/**
 * `reminder.send` (FR-041, FR-042): revalidates at send time — an invoice
 * paid, voided or opted out between planning and sending sends nothing — and
 * hands the email to the delivery pipeline with ids only.
 */
export async function runReminder(
  reminderId: string,
  dependencies: ReminderRunDependencies,
): Promise<void> {
  const database = dependencies.database ?? createDatabase();
  const now = dependencies.now ?? new Date();

  const [reminder] = await database
    .select()
    .from(paymentReminders)
    .where(eq(paymentReminders.id, reminderId));
  if (!reminder || reminder.outcome !== "queued" || reminder.emailDeliveryId) {
    return;
  }
  const [row] = await database
    .select({
      status: documents.status,
      type: documents.documentType,
      total: documents.totalCents,
      remindersEnabled: documents.remindersEnabled,
      clientEmail: clients.email,
      clientReminders: clients.remindersEnabled,
      paid: sql<number>`coalesce((
        SELECT sum(${payments.amountCents}) FROM ${payments}
        WHERE ${payments.documentId} = ${documents.id}
      ), 0)::integer`,
    })
    .from(documents)
    .leftJoin(clients, eq(clients.id, documents.clientId))
    .where(
      and(
        eq(documents.id, reminder.documentId),
        eq(documents.companyId, reminder.companyId),
      ),
    );

  const finish = async (
    outcome: "skipped_paid" | "skipped_no_email" | "sent",
    event: "reminder_sent" | "reminder_skipped",
    emailDeliveryId: string | null,
    reason?: string,
  ) => {
    const [updated] = await database
      .update(paymentReminders)
      .set({ outcome, emailDeliveryId })
      .where(
        and(
          eq(paymentReminders.id, reminder.id),
          eq(paymentReminders.outcome, "queued"),
        ),
      )
      .returning({ id: paymentReminders.id });
    if (updated) {
      await database.insert(documentEvents).values({
        id: createUuidV7(now.getTime()),
        companyId: reminder.companyId,
        documentId: reminder.documentId,
        actor: "system:reminders",
        event,
        payload: { sequence: reminder.sequence, ...(reason ? { reason } : {}) },
        createdAt: now,
      });
    }
  };

  if (
    !row ||
    row.status !== "issued" ||
    row.type !== "invoice" ||
    row.paid >= row.total
  ) {
    await finish("skipped_paid", "reminder_skipped", null, "not_pending");
    return;
  }
  if (!row.remindersEnabled || row.clientReminders === false) {
    await finish("skipped_paid", "reminder_skipped", null, "opted_out");
    return;
  }
  if (!row.clientEmail?.trim()) {
    await finish("skipped_no_email", "reminder_skipped", null, "no_email");
    return;
  }

  // The email carries a public link: create it unless the user disabled it.
  const [anyLink] = await database
    .select({ id: shareLinks.id })
    .from(shareLinks)
    .where(eq(shareLinks.documentId, reminder.documentId));
  if (!anyLink) {
    await createOrReactivateShareLink({
      database,
      companyId: reminder.companyId,
      documentId: reminder.documentId,
      actor: "system:reminders",
      now,
    });
  }

  const idempotencyKey = `payment_reminder:${reminder.id}`;
  const created = await enqueueEmail({
    database,
    queue: dependencies.emailQueue,
    purpose: "payment_reminder",
    template: "payment_reminder",
    companyId: reminder.companyId,
    recipientEmail: row.clientEmail,
    idempotencyKey,
    payload: { document_id: reminder.documentId, reminder_id: reminder.id },
    now,
  });
  // A crash after queueing leaves the delivery behind: link that one.
  const deliveryId =
    created ??
    (
      await database
        .select({ id: emailDeliveries.id })
        .from(emailDeliveries)
        .where(eq(emailDeliveries.idempotencyKey, idempotencyKey))
    )[0]?.id ??
    null;
  await finish("sent", "reminder_sent", deliveryId);
}

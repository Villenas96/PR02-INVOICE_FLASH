import { and, eq, gte, lte, sql } from "drizzle-orm";

import { createDatabase, type Database } from "@/db";
import { clients } from "@/db/schema/client";
import { companies } from "@/db/schema/company";
import { documents } from "@/db/schema/document";
import { payments } from "@/db/schema/payment";
import { paymentReminders } from "@/db/schema/payment-reminder";
import { addCalendarDays } from "@/lib/dates";
import { createUuidV7 } from "@/lib/ids";
import { hasFeature, madridDate } from "@/lib/plan";
import {
  parseReminderPolicy,
  reminderDueOn,
  reminderHorizonDays,
} from "@/lib/reminders";
import { createReminderSendMessage } from "@/workers/messages";

interface JobsQueue {
  send(message: unknown): Promise<void>;
}

const MAX_DAYS_BEFORE = 30;

/**
 * Planner step (FR-041): for companies with an enabled policy (Pro), claims
 * the reminder due today for each unpaid invoice with the unique
 * `(document_id, scheduled_on)` row and enqueues `reminder.send`. The
 * candidate query is bounded by the due-date index and the policy horizon.
 */
export async function planPaymentReminders(dependencies: {
  database?: Database;
  queue: JobsQueue;
  now?: Date;
}): Promise<number> {
  const database = dependencies.database ?? createDatabase();
  const now = dependencies.now ?? new Date();
  const today = madridDate(now);

  const enabled = await database
    .select({
      id: companies.id,
      plan: companies.plan,
      policy: companies.reminderPolicy,
    })
    .from(companies)
    .where(sql`${companies.reminderPolicy} ->> 'enabled' = 'true'`);

  let enqueued = 0;
  for (const company of enabled) {
    const policy = parseReminderPolicy(company.policy);
    if (!policy.enabled || !hasFeature(company.plan, "reminders")) {
      continue;
    }
    const horizon = reminderHorizonDays(policy);
    const candidates = await database
      .select({
        id: documents.id,
        dueDate: documents.dueDate,
        total: documents.totalCents,
        paid: sql<number>`coalesce((
          SELECT sum(${payments.amountCents}) FROM ${payments}
          WHERE ${payments.documentId} = ${documents.id}
        ), 0)::integer`,
      })
      .from(documents)
      .leftJoin(clients, eq(clients.id, documents.clientId))
      .where(
        and(
          eq(documents.companyId, company.id),
          eq(documents.documentType, "invoice"),
          eq(documents.status, "issued"),
          eq(documents.remindersEnabled, true),
          sql`${clients.remindersEnabled} IS NOT FALSE`,
          gte(documents.dueDate, addCalendarDays(today, -horizon)),
          lte(documents.dueDate, addCalendarDays(today, MAX_DAYS_BEFORE)),
        ),
      );

    for (const invoice of candidates) {
      if (!invoice.dueDate || invoice.paid >= invoice.total) {
        continue;
      }
      const due = reminderDueOn(policy, invoice.dueDate, today);
      if (!due) {
        continue;
      }
      const [claimed] = await database
        .insert(paymentReminders)
        .values({
          id: createUuidV7(now.getTime()),
          companyId: company.id,
          documentId: invoice.id,
          scheduledOn: due.scheduledOn,
          sequence: due.sequence,
          createdAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: paymentReminders.id });
      if (claimed) {
        await dependencies.queue.send(
          createReminderSendMessage(claimed.id, now),
        );
        enqueued += 1;
      }
    }
  }
  return enqueued;
}

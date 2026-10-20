import { and, eq, isNotNull, lt, or } from "drizzle-orm";

import type { Database } from "@/db";
import { createDatabase } from "@/db";
import { verifications } from "@/db/schema/auth";
import { emailDeliveries } from "@/db/schema/email-delivery";
import { subscriptions } from "@/db/schema/subscription";
import { logSafe } from "@/lib/log";
import { planAdvisorExports } from "@/services/advisor-schedule";
import { planRecurringCycles } from "@/services/recurring/planner";
import { planPaymentReminders } from "@/services/reminder-planner";
import {
  type ListableBucket,
  purgeOrphanLogos,
} from "@/services/storage-purge";
import { createBillingGraceMessage } from "@/workers/messages";

export const PURGE_CRON = "0 3 * * *";
export const PLANNER_CRON = "0 5 * * *";

export interface JobsQueue {
  send(message: unknown): Promise<void>;
}

export interface PlannerDependencies {
  database?: Database;
  queue: JobsQueue;
  now?: Date;
}

export const PII_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Purges recipient/message PII from terminal deliveries past their 30-day
 * retention limit (data-model.md, Principio IV). `sent` deliveries retain
 * PII until `sentAt`, `failed` ones until their last `updatedAt`.
 */
export async function purgeTerminalEmailDeliveryPii(
  database: Database,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - PII_RETENTION_MS);
  const purged = await database
    .update(emailDeliveries)
    .set({ recipientEmail: null, customMessage: null, updatedAt: now })
    .where(
      and(
        isNotNull(emailDeliveries.recipientEmail),
        or(
          and(
            eq(emailDeliveries.status, "sent"),
            lt(emailDeliveries.sentAt, cutoff),
          ),
          and(
            eq(emailDeliveries.status, "failed"),
            lt(emailDeliveries.updatedAt, cutoff),
          ),
        ),
      ),
    )
    .returning({ id: emailDeliveries.id });

  return purged.length;
}

/**
 * Better Auth verification rows back both live tokens and, transitively,
 * `email_delivery.auth_verification_id` (`ON DELETE SET NULL`). Removing
 * expired rows here is what "removes the auth reference on expiry" means.
 */
export async function purgeExpiredAuthVerifications(
  database: Database,
  now = new Date(),
): Promise<number> {
  const removed = await database
    .delete(verifications)
    .where(lt(verifications.expiresAt, now))
    .returning({ id: verifications.id });

  return removed.length;
}

export async function runScheduledPurge(
  dependencies: {
    database?: Database;
    now?: Date;
    bucket?: ListableBucket;
  } = {},
): Promise<void> {
  const database = dependencies.database ?? createDatabase();
  const now = dependencies.now ?? new Date();
  await purgeTerminalEmailDeliveryPii(database, now);
  await purgeExpiredAuthVerifications(database, now);
  if (dependencies.bucket) {
    await purgeOrphanLogos({ database, bucket: dependencies.bucket, now });
  }
}

/**
 * Planner step: one `billing.grace` job per company in a payment grace
 * period. The handler decides (notice, downgrade or nothing), so re-running
 * the planner is harmless.
 */
export async function planBillingGrace(
  dependencies: PlannerDependencies,
): Promise<number> {
  const database = dependencies.database ?? createDatabase();
  const now = dependencies.now ?? new Date();
  const due = await database
    .select({ companyId: subscriptions.companyId })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.status, "past_due"),
        isNotNull(subscriptions.graceUntil),
      ),
    );
  for (const { companyId } of due) {
    await dependencies.queue.send(createBillingGraceMessage(companyId, now));
  }
  return due.length;
}

/**
 * Daily planner (`0 5 * * *`, research R11): it only selects pending work,
 * inserts idempotent claims and enqueues jobs; it never does the work itself.
 */
export type PlannerSummary = Record<string, number | "failed">;

export async function runDailyPlanner(
  dependencies: PlannerDependencies,
): Promise<PlannerSummary> {
  const database = dependencies.database ?? createDatabase();
  const now = dependencies.now ?? new Date();
  const steps: Array<[string, () => Promise<number>]> = [
    [
      "billing_grace",
      () => planBillingGrace({ ...dependencies, database, now }),
    ],
    [
      "payment_reminders",
      () => planPaymentReminders({ ...dependencies, database, now }),
    ],
    [
      "recurring_cycles",
      () => planRecurringCycles({ ...dependencies, database, now }),
    ],
    [
      "advisor_exports",
      () => planAdvisorExports({ ...dependencies, database, now }),
    ],
  ];
  const summary: PlannerSummary = {};
  for (const [step, run] of steps) {
    // Each step is independent: one failing step must not starve the rest.
    try {
      const planned = await run();
      summary[step] = planned;
      logSafe("info", "planner.step_completed", { step, planned });
    } catch (error) {
      summary[step] = "failed";
      logSafe("error", "planner.step_failed", {
        step,
        error_type: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
  return summary;
}

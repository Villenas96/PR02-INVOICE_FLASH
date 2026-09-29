import { and, eq, isNotNull, lt, or } from "drizzle-orm";

import type { Database } from "@/db";
import { createDatabase } from "@/db";
import { verifications } from "@/db/schema/auth";
import { emailDeliveries } from "@/db/schema/email-delivery";

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
  dependencies: { database?: Database; now?: Date } = {},
): Promise<void> {
  const database = dependencies.database ?? createDatabase();
  const now = dependencies.now ?? new Date();
  await purgeTerminalEmailDeliveryPii(database, now);
  await purgeExpiredAuthVerifications(database, now);
}

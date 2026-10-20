import { eq } from "drizzle-orm";

import type { Database } from "@/db";
import { users } from "@/db/schema/auth";
import { companies } from "@/db/schema/company";
import { emailDeliveries } from "@/db/schema/email-delivery";
import { createUuidV7 } from "@/lib/ids";
import type { EmailQueue } from "@/services/email/auth-deliveries";
import { createEmailSendMessage } from "@/workers/messages";

export type NoticePurpose = Extract<
  (typeof emailDeliveries.$inferInsert)["purpose"],
  "billing_notice" | "user_notice"
>;

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export interface EnqueueNoticeInput {
  database: Database;
  queue: EmailQueue;
  purpose: NoticePurpose;
  template: string;
  companyId: string;
  /** One email per key: retries and repeated triggers never duplicate. */
  idempotencyKey: string;
  /** Template parameters; never NIF, IBAN, amounts, emails or tokens. */
  payload?: Record<string, string | number | boolean | null>;
  now?: Date;
}

/**
 * Queues a notice email to the company's account owner. The delivery row is
 * the idempotency claim; only the opaque delivery id goes on the queue.
 */
export async function enqueueNotice(
  input: EnqueueNoticeInput,
): Promise<string | null> {
  const now = input.now ?? new Date();
  const [owner] = await input.database
    .select({ userId: users.id, email: users.email })
    .from(companies)
    .innerJoin(users, eq(users.id, companies.userId))
    .where(eq(companies.id, input.companyId))
    .limit(1);
  if (!owner) {
    return null;
  }

  const [created] = await input.database
    .insert(emailDeliveries)
    .values({
      id: createUuidV7(now.getTime()),
      purpose: input.purpose,
      template: input.template,
      payload: input.payload ?? null,
      companyId: input.companyId,
      userId: owner.userId,
      idempotencyKey: input.idempotencyKey,
      recipientEmail: owner.email,
      recipientHash: await sha256(owner.email),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: emailDeliveries.idempotencyKey })
    .returning({ id: emailDeliveries.id });

  if (!created) {
    return null;
  }
  await input.queue.send(createEmailSendMessage(created.id));
  return created.id;
}

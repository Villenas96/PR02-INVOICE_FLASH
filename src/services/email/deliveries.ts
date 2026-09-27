import { and, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { createDatabase } from "@/db";
import { emailDeliveries } from "@/db/schema/email-delivery";
import { ApiError } from "@/lib/api/errors";
import { createUuidV7 } from "@/lib/ids";

export interface DocumentDeliveryRecord {
  id: string;
  status: "queued" | "sending" | "sent" | "failed";
}

export interface ClaimedDocumentDelivery {
  id: string;
  companyId: string;
  documentId: string;
  recipientEmail: string;
  customMessage: string | null;
  createdAt: Date;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function idempotencyConflictError(): ApiError {
  return new ApiError(
    "idempotency_key_invalid",
    409,
    "Esta clave de idempotencia ya se ha usado para otro documento. Usa una clave nueva.",
  );
}

/**
 * Inserts the delivery before any queue message is published; a repeated
 * `Idempotency-Key` returns the original row without a second effect. The
 * queue body will only ever carry this row's opaque id.
 */
export async function createOrReuseDocumentEmailDelivery(input: {
  database?: Database;
  companyId: string;
  documentId: string;
  requestedBy: string;
  recipientEmail: string;
  customMessage: string | null;
  idempotencyKey: string;
  now?: Date;
}): Promise<DocumentDeliveryRecord> {
  const database = input.database ?? createDatabase();
  const now = input.now ?? new Date();
  const id = createUuidV7(now.getTime());

  const [created] = await database
    .insert(emailDeliveries)
    .values({
      id,
      purpose: "document",
      companyId: input.companyId,
      documentId: input.documentId,
      requestedBy: input.requestedBy,
      idempotencyKey: input.idempotencyKey,
      recipientEmail: input.recipientEmail,
      recipientHash: await sha256(input.recipientEmail),
      customMessage: input.customMessage,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: emailDeliveries.idempotencyKey })
    .returning({ id: emailDeliveries.id, status: emailDeliveries.status });

  if (created) {
    return created;
  }

  const [existing] = await database
    .select({
      id: emailDeliveries.id,
      status: emailDeliveries.status,
      documentId: emailDeliveries.documentId,
      companyId: emailDeliveries.companyId,
    })
    .from(emailDeliveries)
    .where(eq(emailDeliveries.idempotencyKey, input.idempotencyKey))
    .limit(1);

  if (!existing) {
    throw new Error("No se ha podido persistir la entrega documental.");
  }
  if (
    existing.documentId !== input.documentId ||
    existing.companyId !== input.companyId
  ) {
    throw idempotencyConflictError();
  }

  return { id: existing.id, status: existing.status };
}

/** Atomically claims a `queued`/`failed` document delivery for sending. */
export async function claimDocumentDelivery(
  database: Database,
  deliveryId: string,
  now: Date,
): Promise<ClaimedDocumentDelivery | null> {
  const [claimed] = await database
    .update(emailDeliveries)
    .set({
      status: "sending",
      attemptCount: sql`${emailDeliveries.attemptCount} + 1`,
      lastErrorCode: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(emailDeliveries.id, deliveryId),
        inArray(emailDeliveries.status, ["queued", "failed"]),
        eq(emailDeliveries.purpose, "document"),
      ),
    )
    .returning({
      id: emailDeliveries.id,
      companyId: emailDeliveries.companyId,
      documentId: emailDeliveries.documentId,
      recipientEmail: emailDeliveries.recipientEmail,
      customMessage: emailDeliveries.customMessage,
      createdAt: emailDeliveries.createdAt,
    });

  if (
    !claimed ||
    !claimed.companyId ||
    !claimed.documentId ||
    !claimed.recipientEmail
  ) {
    return null;
  }

  return {
    id: claimed.id,
    companyId: claimed.companyId,
    documentId: claimed.documentId,
    recipientEmail: claimed.recipientEmail,
    customMessage: claimed.customMessage,
    createdAt: claimed.createdAt,
  };
}

export async function markDocumentDeliverySent(
  database: Database,
  deliveryId: string,
  providerMessageId: string,
  now: Date,
): Promise<void> {
  await database
    .update(emailDeliveries)
    .set({
      status: "sent",
      providerMessageId,
      lastErrorCode: null,
      sentAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(emailDeliveries.id, deliveryId),
        eq(emailDeliveries.status, "sending"),
      ),
    );
}

export async function markDocumentDeliveryFailed(
  database: Database,
  deliveryId: string,
  errorCode: string,
  now: Date,
): Promise<void> {
  await database
    .update(emailDeliveries)
    .set({ status: "failed", lastErrorCode: errorCode, updatedAt: now })
    .where(
      and(
        eq(emailDeliveries.id, deliveryId),
        eq(emailDeliveries.status, "sending"),
      ),
    );
}

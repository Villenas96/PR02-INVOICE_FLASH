import { and, eq } from "drizzle-orm";

import type { Database } from "@/db";
import { createDatabase } from "@/db";
import { emailDeliveries, verifications } from "@/db/schema";
import type { AuthEmailDeliveryRequest, AuthEmailPurpose } from "@/lib/auth";
import { createUuidV7 } from "@/lib/ids";
import { createEmailSendMessage } from "@/workers/messages";

export const EMAIL_VERIFICATION_EXPIRES_IN_SECONDS = 60 * 60;
export const PASSWORD_RESET_EXPIRES_IN_SECONDS = 60 * 60;

export interface EmailQueue {
  send(message: unknown): Promise<void>;
}

export interface AuthDeliveryDependencies {
  database?: Database;
  queue: EmailQueue;
  now?: Date;
}

interface AuthVerification {
  id: string;
  expiresAt: Date;
}

function resetIdentifier(token: string): string {
  return `reset-password:${token}`;
}

function verificationIdentifier(token: string): string {
  return `verify-email:${token}`;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function resolveResetVerification(
  database: Database,
  request: AuthEmailDeliveryRequest,
): Promise<AuthVerification> {
  const [verification] = await database
    .select({
      id: verifications.id,
      expiresAt: verifications.expiresAt,
    })
    .from(verifications)
    .where(
      and(
        eq(verifications.identifier, resetIdentifier(request.token)),
        eq(verifications.value, request.userId),
      ),
    )
    .limit(1);

  if (!verification) {
    throw new Error(
      "Better Auth no ha persistido la verificación de recuperación.",
    );
  }

  return verification;
}

async function createEmailVerification(
  database: Database,
  request: AuthEmailDeliveryRequest,
  now: Date,
): Promise<AuthVerification> {
  const identifier = verificationIdentifier(request.token);
  const existing = await database
    .select({
      id: verifications.id,
      expiresAt: verifications.expiresAt,
    })
    .from(verifications)
    .where(
      and(
        eq(verifications.identifier, identifier),
        eq(verifications.value, request.userId),
      ),
    )
    .limit(1);

  if (existing[0]) {
    return existing[0];
  }

  const [created] = await database
    .insert(verifications)
    .values({
      id: createUuidV7(),
      identifier,
      value: request.userId,
      expiresAt: new Date(
        now.getTime() + EMAIL_VERIFICATION_EXPIRES_IN_SECONDS * 1000,
      ),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({
      id: verifications.id,
      expiresAt: verifications.expiresAt,
    });

  if (created) {
    return created;
  }

  const [concurrentlyCreated] = await database
    .select({
      id: verifications.id,
      expiresAt: verifications.expiresAt,
    })
    .from(verifications)
    .where(
      and(
        eq(verifications.identifier, identifier),
        eq(verifications.value, request.userId),
      ),
    )
    .limit(1);

  if (!concurrentlyCreated) {
    throw new Error("No se ha podido persistir la verificación del correo.");
  }

  return concurrentlyCreated;
}

async function resolveVerification(
  database: Database,
  request: AuthEmailDeliveryRequest,
  now: Date,
): Promise<AuthVerification> {
  return request.purpose === "reset_password"
    ? resolveResetVerification(database, request)
    : createEmailVerification(database, request, now);
}

function authIdempotencyKey(
  purpose: AuthEmailPurpose,
  verificationId: string,
): string {
  return `auth/${purpose}/${verificationId}`;
}

/**
 * Persists the complete auth delivery before publishing an identifier-only
 * queue message. Tokens and recipients remain in Postgres and never cross the
 * queue boundary.
 */
export async function enqueueAuthEmailDelivery(
  request: AuthEmailDeliveryRequest,
  dependencies: AuthDeliveryDependencies,
): Promise<string> {
  const database = dependencies.database ?? createDatabase();
  const now = dependencies.now ?? new Date();
  const verification = await resolveVerification(database, request, now);
  const idempotencyKey = authIdempotencyKey(request.purpose, verification.id);

  const [created] = await database
    .insert(emailDeliveries)
    .values({
      id: createUuidV7(),
      purpose: request.purpose,
      userId: request.userId,
      authVerificationId: verification.id,
      idempotencyKey,
      recipientEmail: request.recipientEmail,
      recipientHash: await sha256(request.recipientEmail),
      status: "queued",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: emailDeliveries.idempotencyKey })
    .returning({ id: emailDeliveries.id });

  const delivery =
    created ??
    (
      await database
        .select({ id: emailDeliveries.id })
        .from(emailDeliveries)
        .where(eq(emailDeliveries.idempotencyKey, idempotencyKey))
        .limit(1)
    )[0];

  if (!delivery) {
    throw new Error("No se ha podido persistir la entrega de autenticación.");
  }

  await dependencies.queue.send(createEmailSendMessage(delivery.id));
  return delivery.id;
}

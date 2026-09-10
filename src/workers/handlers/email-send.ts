import { and, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { createDatabase } from "@/db";
import { emailDeliveries, verifications } from "@/db/schema";
import type { AuthEmailPurpose } from "@/lib/auth";
import { renderAuthEmailTemplate } from "@/services/email/templates/auth";
import {
  EMAIL_RETRY_WINDOW_MS,
  type EmailSendMessage,
} from "@/workers/messages";
import { RetryableQueueError } from "@/workers/queue-consumer";

export interface TransactionalEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
}

export interface TransactionalEmailProvider {
  send(message: TransactionalEmail): Promise<{ id: string }>;
}

export type DocumentEmailHandler = (message: EmailSendMessage) => Promise<void>;

export interface EmailSendHandlerDependencies {
  database?: Database;
  provider: TransactionalEmailProvider;
  appBaseUrl: string;
  documentHandler?: DocumentEmailHandler;
  now?: () => Date;
}

type ClaimedAuthDelivery = {
  id: string;
  purpose: AuthEmailPurpose;
  recipientEmail: string | null;
  authVerificationId: string | null;
  createdAt: Date;
};

function authApiUrl(appBaseUrl: string, path: string): URL {
  const url = new URL(appBaseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  const authPath = basePath.endsWith("/api/auth") ? basePath : "/api/auth";
  url.pathname = `${authPath}/${path.replace(/^\/+/, "")}`;
  url.search = "";
  url.hash = "";
  return url;
}

function tokenFromIdentifier(
  purpose: AuthEmailPurpose,
  identifier: string,
): string | null {
  const prefix =
    purpose === "verify_email" ? "verify-email:" : "reset-password:";
  return identifier.startsWith(prefix) ? identifier.slice(prefix.length) : null;
}

export function buildAuthActionUrl({
  appBaseUrl,
  identifier,
  purpose,
}: {
  appBaseUrl: string;
  identifier: string;
  purpose: AuthEmailPurpose;
}): string {
  const token = tokenFromIdentifier(purpose, identifier);

  if (!token) {
    throw new Error("La referencia de autenticación no coincide con su uso.");
  }

  if (purpose === "verify_email") {
    const url = authApiUrl(appBaseUrl, "verify-email");
    url.searchParams.set("token", token);
    url.searchParams.set(
      "callbackURL",
      new URL("/login", appBaseUrl).toString(),
    );
    return url.toString();
  }

  const url = authApiUrl(
    appBaseUrl,
    `reset-password/${encodeURIComponent(token)}`,
  );
  url.searchParams.set(
    "callbackURL",
    new URL("/reset-password", appBaseUrl).toString(),
  );
  return url.toString();
}

function retryDeadline(createdAt: Date, authExpiresAt: Date): Date {
  return new Date(
    Math.min(
      createdAt.getTime() + EMAIL_RETRY_WINDOW_MS,
      authExpiresAt.getTime(),
    ),
  );
}

async function markFailed(
  database: Database,
  deliveryId: string,
  errorCode: string,
  now: Date,
): Promise<void> {
  await database
    .update(emailDeliveries)
    .set({
      status: "failed",
      lastErrorCode: errorCode,
      updatedAt: now,
    })
    .where(
      and(
        eq(emailDeliveries.id, deliveryId),
        eq(emailDeliveries.status, "sending"),
      ),
    );
}

async function claimAuthDelivery(
  database: Database,
  deliveryId: string,
  now: Date,
): Promise<ClaimedAuthDelivery | null> {
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
        inArray(emailDeliveries.purpose, ["verify_email", "reset_password"]),
      ),
    )
    .returning({
      id: emailDeliveries.id,
      purpose: emailDeliveries.purpose,
      recipientEmail: emailDeliveries.recipientEmail,
      authVerificationId: emailDeliveries.authVerificationId,
      createdAt: emailDeliveries.createdAt,
    });

  if (
    !claimed ||
    (claimed.purpose !== "verify_email" && claimed.purpose !== "reset_password")
  ) {
    return null;
  }

  return {
    ...claimed,
    purpose: claimed.purpose,
  };
}

async function handleAuthEmail(
  message: EmailSendMessage,
  dependencies: EmailSendHandlerDependencies,
): Promise<void> {
  const database = dependencies.database ?? createDatabase();
  const now = dependencies.now?.() ?? new Date();
  const claimed = await claimAuthDelivery(database, message.deliveryId, now);

  // A sent or currently claimed delivery is an idempotent success. A failed
  // attempt is explicitly returned to `failed` before throwing and can be
  // reclaimed by the queue retry.
  if (!claimed) {
    return;
  }

  if (!claimed.recipientEmail || !claimed.authVerificationId) {
    await markFailed(database, claimed.id, "auth_reference_missing", now);
    return;
  }

  const [verification] = await database
    .select({
      identifier: verifications.identifier,
      expiresAt: verifications.expiresAt,
    })
    .from(verifications)
    .where(eq(verifications.id, claimed.authVerificationId))
    .limit(1);

  if (!verification) {
    await markFailed(database, claimed.id, "auth_reference_missing", now);
    return;
  }

  const retryUntil = retryDeadline(claimed.createdAt, verification.expiresAt);

  if (now.getTime() >= retryUntil.getTime()) {
    await markFailed(database, claimed.id, "auth_reference_expired", now);
    throw new RetryableQueueError(
      "La entrega de autenticación ha caducado.",
      retryUntil,
    );
  }

  let actionUrl: string;

  try {
    actionUrl = buildAuthActionUrl({
      appBaseUrl: dependencies.appBaseUrl,
      identifier: verification.identifier,
      purpose: claimed.purpose,
    });
  } catch {
    await markFailed(database, claimed.id, "auth_reference_invalid", now);
    return;
  }

  const template = renderAuthEmailTemplate(claimed.purpose, actionUrl);

  try {
    const providerResult = await dependencies.provider.send({
      to: claimed.recipientEmail,
      ...template,
      idempotencyKey: `email/${claimed.id}`,
    });

    await database
      .update(emailDeliveries)
      .set({
        status: "sent",
        providerMessageId: providerResult.id,
        lastErrorCode: null,
        sentAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(emailDeliveries.id, claimed.id),
          eq(emailDeliveries.status, "sending"),
        ),
      );
  } catch {
    await markFailed(database, claimed.id, "provider_unavailable", now);
    throw new RetryableQueueError(
      "El proveedor de correo no está disponible.",
      retryUntil,
    );
  }
}

/**
 * Purpose-aware base dispatcher. Authentication deliveries are implemented
 * here; the document branch is injected by the document-email task.
 */
export function createEmailSendHandler(
  dependencies: EmailSendHandlerDependencies,
): (message: EmailSendMessage) => Promise<void> {
  return async (message) => {
    const database = dependencies.database ?? createDatabase();
    const [delivery] = await database
      .select({
        purpose: emailDeliveries.purpose,
        status: emailDeliveries.status,
      })
      .from(emailDeliveries)
      .where(eq(emailDeliveries.id, message.deliveryId))
      .limit(1);

    if (!delivery || delivery.status === "sent") {
      return;
    }

    if (delivery.purpose === "document") {
      if (!dependencies.documentHandler) {
        throw new Error(
          "El consumidor de correo documental no está configurado.",
        );
      }
      await dependencies.documentHandler(message);
      return;
    }

    await handleAuthEmail(message, {
      ...dependencies,
      database,
    });
  };
}

export function createResendEmailProvider({
  apiKey,
  from,
  fetchImplementation = fetch,
}: {
  apiKey: string;
  from: string;
  fetchImplementation?: typeof fetch;
}): TransactionalEmailProvider {
  return {
    async send(message) {
      const response = await fetchImplementation(
        "https://api.resend.com/emails",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": message.idempotencyKey,
          },
          body: JSON.stringify({
            from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
        },
      );

      if (!response.ok) {
        throw new Error("Resend ha rechazado temporalmente la entrega.");
      }

      const body: unknown = await response.json();
      const id =
        body &&
        typeof body === "object" &&
        "id" in body &&
        typeof body.id === "string"
          ? body.id
          : null;

      if (!id) {
        throw new Error("Resend no ha devuelto un identificador de entrega.");
      }

      return { id };
    },
  };
}

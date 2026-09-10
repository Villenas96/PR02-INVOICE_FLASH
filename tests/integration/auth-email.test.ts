import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDatabase } from "@/db";
import { emailDeliveries, verifications } from "@/db/schema";
import type { EmailQueue } from "@/services/email/auth-deliveries";
import { enqueueAuthEmailDelivery } from "@/services/email/auth-deliveries";
import {
  createEmailSendHandler,
  type TransactionalEmail,
  type TransactionalEmailProvider,
} from "@/workers/handlers/email-send";
import {
  type EmailSendMessage,
  emailSendMessageSchema,
} from "@/workers/messages";
import {
  processQueueBatch,
  type QueueConsumers,
  type QueueDelivery,
} from "@/workers/queue-consumer";

import { integrationDatabaseUrl } from "./database";

const appBaseUrl = "http://localhost:3000";
const databaseUrl = integrationDatabaseUrl();
process.env.DATABASE_URL = databaseUrl;
process.env.BETTER_AUTH_SECRET =
  "invoice-flash-integration-secret-at-least-thirty-two-characters";
process.env.BETTER_AUTH_URL = appBaseUrl;

const database = createDatabase(databaseUrl);
const { auth, setAuthEmailDeliveryHandler } = await import("@/lib/auth");

interface QueueDeliveryFixture {
  delivery: QueueDelivery;
  ackCount: () => number;
  retryCount: () => number;
}

const queuedBodies: unknown[] = [];
const providerCalls: TransactionalEmail[] = [];
let testNow = new Date();

const queue: EmailQueue = {
  send(message) {
    queuedBodies.push(message);
    return Promise.resolve();
  },
};

const provider: TransactionalEmailProvider = {
  send(message) {
    providerCalls.push(message);
    return Promise.resolve({ id: `provider-${providerCalls.length}` });
  },
};

function createQueueDelivery(
  body: unknown,
  attempts = 0,
): QueueDeliveryFixture {
  let acknowledgements = 0;
  let retries = 0;

  return {
    delivery: {
      body,
      attempts,
      ack() {
        acknowledgements += 1;
      },
      retry() {
        retries += 1;
      },
    },
    ackCount: () => acknowledgements,
    retryCount: () => retries,
  };
}

function emailMessageAt(index = 0): EmailSendMessage {
  return emailSendMessageSchema.parse(queuedBodies[index]);
}

async function postAuth(
  path: string,
  body: Record<string, string>,
): Promise<Response> {
  return auth.handler(
    new Request(`${appBaseUrl}/api/auth${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function signUp(email: string): Promise<Response> {
  return postAuth("/sign-up/email", {
    name: "Integration User",
    email,
    password: "integration-password-123",
  });
}

async function requestPasswordReset(email: string): Promise<Response> {
  return postAuth("/request-password-reset", { email });
}

async function deliveryVerification(message: EmailSendMessage) {
  const [delivery] = await database
    .select({
      purpose: emailDeliveries.purpose,
      recipientEmail: emailDeliveries.recipientEmail,
      authVerificationId: emailDeliveries.authVerificationId,
      status: emailDeliveries.status,
      attemptCount: emailDeliveries.attemptCount,
    })
    .from(emailDeliveries)
    .where(eq(emailDeliveries.id, message.deliveryId))
    .limit(1);

  if (!delivery?.authVerificationId) {
    throw new Error("La entrega no contiene una referencia de autenticación.");
  }

  const [verification] = await database
    .select({
      identifier: verifications.identifier,
      expiresAt: verifications.expiresAt,
    })
    .from(verifications)
    .where(eq(verifications.id, delivery.authVerificationId))
    .limit(1);

  if (!verification) {
    throw new Error("No se ha encontrado la verificación de autenticación.");
  }

  return { delivery, verification };
}

function tokenFromIdentifier(identifier: string): string {
  const separator = identifier.indexOf(":");
  if (separator < 0) {
    throw new Error("La verificación no contiene un token.");
  }
  return identifier.slice(separator + 1);
}

function queueConsumers(
  emailProvider: TransactionalEmailProvider = provider,
): QueueConsumers {
  return {
    renderPdf: () =>
      Promise.reject(
        new Error("El consumidor PDF no debe recibir mensajes de email."),
      ),
    sendEmail: createEmailSendHandler({
      database,
      provider: emailProvider,
      appBaseUrl,
      now: () => new Date(testNow.getTime() + 1_000),
    }),
  };
}

describe("queued authentication email", () => {
  beforeEach(() => {
    queuedBodies.length = 0;
    providerCalls.length = 0;
    testNow = new Date();
    setAuthEmailDeliveryHandler(async (request) => {
      await enqueueAuthEmailDelivery(request, {
        database,
        queue,
        now: testNow,
      });
    });
  });

  it("enqueues verification and reset deliveries without calling the provider in HTTP", async () => {
    const recipient = "auth-http@example.test";
    const signUpResponse = await signUp(recipient);

    expect(signUpResponse.status).toBe(200);
    expect(providerCalls).toHaveLength(0);
    expect(queuedBodies).toHaveLength(1);

    const verificationMessage = emailMessageAt();
    const verificationRecord = await deliveryVerification(verificationMessage);
    expect(verificationRecord.delivery).toMatchObject({
      purpose: "verify_email",
      recipientEmail: recipient,
      status: "queued",
      attemptCount: 0,
    });

    const resetResponse = await requestPasswordReset(recipient);

    expect(resetResponse.status).toBe(200);
    expect(providerCalls).toHaveLength(0);
    expect(queuedBodies).toHaveLength(2);

    const resetMessage = emailMessageAt(1);
    const resetRecord = await deliveryVerification(resetMessage);
    expect(resetRecord.delivery).toMatchObject({
      purpose: "reset_password",
      recipientEmail: recipient,
      status: "queued",
      attemptCount: 0,
    });

    for (const { message, identifier } of [
      {
        message: verificationMessage,
        identifier: verificationRecord.verification.identifier,
      },
      {
        message: resetMessage,
        identifier: resetRecord.verification.identifier,
      },
    ]) {
      const serializedBody = JSON.stringify(message);
      expect(Object.keys(message).sort()).toEqual([
        "deliveryId",
        "enqueuedAt",
        "type",
      ]);
      expect(serializedBody).not.toContain(recipient);
      expect(serializedBody).not.toContain(tokenFromIdentifier(identifier));
      expect(serializedBody).not.toContain("http");
    }
  });

  it("sends a duplicate queue delivery only once", async () => {
    const recipient = "duplicate@example.test";
    expect((await signUp(recipient)).status).toBe(200);

    const message = emailMessageAt();
    const firstDelivery = createQueueDelivery(message);
    const duplicateDelivery = createQueueDelivery(message);
    const consumers = queueConsumers();

    await processQueueBatch(
      { messages: [firstDelivery.delivery, duplicateDelivery.delivery] },
      consumers,
      testNow,
    );

    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0]).toMatchObject({
      to: recipient,
      idempotencyKey: `email/${message.deliveryId}`,
    });
    expect(firstDelivery.ackCount()).toBe(1);
    expect(duplicateDelivery.ackCount()).toBe(1);
    expect(firstDelivery.retryCount()).toBe(0);
    expect(duplicateDelivery.retryCount()).toBe(0);

    const redelivery = createQueueDelivery(message, 1);
    await processQueueBatch(
      { messages: [redelivery.delivery] },
      consumers,
      testNow,
    );

    expect(providerCalls).toHaveLength(1);
    expect(redelivery.ackCount()).toBe(1);

    const { delivery } = await deliveryVerification(message);
    expect(delivery).toMatchObject({
      status: "sent",
      attemptCount: 1,
    });
  });

  it("returns an indistinguishable recovery response for a nonexistent account", async () => {
    const existingEmail = "existing@example.test";
    const nonexistentEmail = "nonexistent@example.test";
    expect((await signUp(existingEmail)).status).toBe(200);
    queuedBodies.length = 0;

    const existingResponse = await requestPasswordReset(existingEmail);
    const existingBody: unknown = await existingResponse.json();
    const nonexistentResponse = await requestPasswordReset(nonexistentEmail);
    const nonexistentBody: unknown = await nonexistentResponse.json();

    expect(nonexistentResponse.status).toBe(existingResponse.status);
    expect(nonexistentBody).toEqual(existingBody);
    expect(existingResponse.status).toBe(200);
    expect(existingBody).toMatchObject({ status: true });
    expect(queuedBodies).toHaveLength(1);
    expect(providerCalls).toHaveLength(0);
  });

  it("keeps recipients, tokens and URLs out of queue bodies and failure logs", async () => {
    const recipient = "private-auth@example.test";
    expect((await signUp(recipient)).status).toBe(200);

    const message = emailMessageAt();
    const { verification } = await deliveryVerification(message);
    const token = tokenFromIdentifier(verification.identifier);
    const serializedBody = JSON.stringify(message);
    const logEntries: string[] = [];
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation((entry) => {
        logEntries.push(String(entry));
      });
    const failingProvider: TransactionalEmailProvider = {
      send() {
        return Promise.reject(new Error("Provider unavailable"));
      },
    };
    const delivery = createQueueDelivery(message);

    try {
      await processQueueBatch(
        { messages: [delivery.delivery] },
        queueConsumers(failingProvider),
        testNow,
      );
    } finally {
      consoleError.mockRestore();
    }

    const serializedLogs = logEntries.join("\n");
    expect(serializedBody).toEqual(
      JSON.stringify({
        type: "email.send",
        deliveryId: message.deliveryId,
        enqueuedAt: message.enqueuedAt,
      }),
    );
    expect(serializedLogs).toContain("queue.delivery_failed");
    expect(serializedLogs).not.toContain("http");
    for (const sensitiveValue of [recipient, token, appBaseUrl]) {
      expect(serializedBody).not.toContain(sensitiveValue);
      expect(serializedLogs).not.toContain(sensitiveValue);
    }
    expect(delivery.ackCount()).toBe(0);
    expect(delivery.retryCount()).toBe(1);
  });
});

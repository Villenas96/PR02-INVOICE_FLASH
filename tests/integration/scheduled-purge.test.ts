import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { emailDeliveries, verifications } from "@/db/schema";

import { createIntegrationDatabase } from "./database";

process.env.BETTER_AUTH_SECRET =
  "invoice-flash-scheduled-purge-secret-at-least-32-chars";

const database = createIntegrationDatabase();
vi.mock("@/db", () => ({
  createDatabase: () => database,
}));
vi.mock("@/db/index", () => ({
  createDatabase: () => database,
}));
const { purgeExpiredAuthVerifications, purgeTerminalEmailDeliveryPii } =
  await import("@/workers/scheduled");

const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1000;

async function seedDelivery(overrides: {
  status: "sent" | "failed";
  terminalAt: Date;
}): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date();
  await database.insert(emailDeliveries).values({
    id,
    purpose: "document",
    idempotencyKey: crypto.randomUUID(),
    recipientEmail: "still-here@example.test",
    recipientHash: "hash",
    customMessage: "hola",
    status: overrides.status,
    sentAt: overrides.status === "sent" ? overrides.terminalAt : null,
    createdAt: now,
    updatedAt: overrides.status === "failed" ? overrides.terminalAt : now,
  });
  return id;
}

describe("scheduled purge", () => {
  it("clears recipient and message PII only for terminal deliveries past retention", async () => {
    const now = new Date();
    const oldSent = await seedDelivery({
      status: "sent",
      terminalAt: new Date(now.getTime() - THIRTY_ONE_DAYS_MS),
    });
    const recentSent = await seedDelivery({
      status: "sent",
      terminalAt: now,
    });
    const oldFailed = await seedDelivery({
      status: "failed",
      terminalAt: new Date(now.getTime() - THIRTY_ONE_DAYS_MS),
    });

    await purgeTerminalEmailDeliveryPii(database, now);

    const rows = await database
      .select({
        id: emailDeliveries.id,
        recipientEmail: emailDeliveries.recipientEmail,
        customMessage: emailDeliveries.customMessage,
      })
      .from(emailDeliveries);
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

    expect(byId[oldSent].recipientEmail).toBeNull();
    expect(byId[oldSent].customMessage).toBeNull();
    expect(byId[oldFailed].recipientEmail).toBeNull();
    expect(byId[recentSent].recipientEmail).not.toBeNull();
  });

  it("removes expired auth verifications and nulls their email_delivery reference", async () => {
    const now = new Date();
    const verificationId = crypto.randomUUID();
    await database.insert(verifications).values({
      id: verificationId,
      identifier: "verify-email:expired-token",
      value: crypto.randomUUID(),
      expiresAt: new Date(now.getTime() - 1_000),
      createdAt: now,
      updatedAt: now,
    });
    const deliveryId = crypto.randomUUID();
    await database.insert(emailDeliveries).values({
      id: deliveryId,
      purpose: "verify_email",
      authVerificationId: verificationId,
      idempotencyKey: crypto.randomUUID(),
      recipientHash: "hash",
      status: "sent",
      sentAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const removedCount = await purgeExpiredAuthVerifications(database, now);
    expect(removedCount).toBe(1);

    const [remainingVerification] = await database
      .select({ id: verifications.id })
      .from(verifications)
      .where(eq(verifications.id, verificationId));
    expect(remainingVerification).toBeUndefined();

    const [delivery] = await database
      .select({ authVerificationId: emailDeliveries.authVerificationId })
      .from(emailDeliveries)
      .where(eq(emailDeliveries.id, deliveryId));
    expect(delivery?.authVerificationId).toBeNull();
  });
});

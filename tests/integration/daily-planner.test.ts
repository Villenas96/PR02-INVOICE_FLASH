import { describe, expect, it } from "vitest";

import { subscriptions } from "@/db/schema";
import { jobMessageSchema } from "@/workers/messages";
import { runDailyPlanner } from "@/workers/scheduled";

import { createIntegrationDatabase } from "./database";
import { createOwner, recordingQueue } from "./fixtures";

const database = createIntegrationDatabase();
const NOW = new Date("2026-10-20T05:00:00.000Z");

async function pastDueOwner(): Promise<string> {
  const owner = await createOwner(database, { plan: "essential" });
  await database.insert(subscriptions).values({
    id: crypto.randomUUID(),
    companyId: owner.companyId,
    stripeCustomerId: `cus_${crypto.randomUUID()}`,
    plan: "essential",
    status: "past_due",
    graceUntil: new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1_000),
    lastSyncedAt: NOW,
  });
  return owner.companyId;
}

describe("daily planner (0 5 * * *)", () => {
  it("only enqueues opaque jobs with the injected clock and reports each step", async () => {
    const companyId = await pastDueOwner();
    const queue = recordingQueue();

    const summary = await runDailyPlanner({ database, queue, now: NOW });

    expect(summary.billing_grace).toBeGreaterThanOrEqual(1);
    const jobs = queue.messages.map((message) =>
      jobMessageSchema.parse(message),
    );
    expect(jobs).toContainEqual({
      type: "billing.grace",
      companyId,
      enqueuedAt: NOW.toISOString(),
    });
  });

  it("keeps going when the queue fails and reports the step as failed", async () => {
    await pastDueOwner();
    const summary = await runDailyPlanner({
      database,
      queue: { send: () => Promise.reject(new Error("queue down")) },
      now: NOW,
    });
    expect(summary.billing_grace).toBe("failed");
  });
});

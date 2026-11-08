import { and, count, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  companies,
  documents,
  emailDeliveries,
  planChanges,
  subscriptions,
} from "@/db/schema";
import { reconcileSubscription } from "@/services/billing/reconcile";
import { setStripeClientFactory } from "@/services/billing/stripe";
import { handleBillingGrace } from "@/workers/handlers/billing-grace";
import { emailSendMessageSchema, jobMessageSchema } from "@/workers/messages";
import { planBillingGrace } from "@/workers/scheduled";

import { createIntegrationDatabase } from "./database";
import {
  createOwner,
  createSeries,
  type OwnerFixture,
  recordingQueue,
  seedIssuedDocuments,
} from "./fixtures";
import {
  FakeStripe,
  signedWebhookRequest,
  TEST_WEBHOOK_SECRET,
} from "./stripe-fake";

const cloudflareState = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => Promise.resolve({ env: cloudflareState.env }),
}));

const database = createIntegrationDatabase();
const { POST: stripeWebhook } = await import("@/app/api/webhooks/stripe/route");
const DAY_MS = 24 * 60 * 60 * 1_000;

let stripe: FakeStripe;

beforeEach(() => {
  stripe = new FakeStripe();
  setStripeClientFactory(() => stripe.client());
  process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
  cloudflareState.env = { EMAIL_SEND_QUEUE: { send: () => Promise.resolve() } };
});

afterEach(() => {
  setStripeClientFactory(null);
});

async function subscribedOwner(customer: string): Promise<OwnerFixture> {
  const owner = await createOwner(database, { plan: "basic" });
  stripe.setSubscription(customer, { lookupKey: "essential_monthly" });
  await reconcileSubscription(
    { companyId: owner.companyId, stripeCustomerId: customer },
    { database, stripe: stripe.client(), reason: "checkout" },
  );
  return owner;
}

async function subscriptionRow(companyId: string) {
  const [row] = await database
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.companyId, companyId));
  if (!row) {
    throw new Error("missing subscription");
  }
  return row;
}

async function notices(companyId: string) {
  return database
    .select({ template: emailDeliveries.template })
    .from(emailDeliveries)
    .where(
      and(
        eq(emailDeliveries.companyId, companyId),
        eq(emailDeliveries.purpose, "billing_notice"),
      ),
    );
}

describe("subscription grace period", () => {
  it("opens a 7-day grace on a failed renewal and keeps the plan", async () => {
    const owner = await subscribedOwner("cus_fail");
    stripe.setSubscription("cus_fail", { status: "past_due" });
    const before = Date.now();

    const response = await stripeWebhook(
      await signedWebhookRequest({
        id: "evt_fail",
        type: "invoice.payment_failed",
        data: {
          object: { id: "in_f", object: "invoice", customer: "cus_fail" },
        },
      }),
    );

    expect(response.status).toBe(200);
    const row = await subscriptionRow(owner.companyId);
    expect(row.status).toBe("past_due");
    const graceMs = (row.graceUntil?.getTime() ?? 0) - before;
    expect(graceMs).toBeGreaterThanOrEqual(7 * DAY_MS - 1_000);
    expect(graceMs).toBeLessThanOrEqual(7 * DAY_MS + 60_000);
    const [company] = await database
      .select({ plan: companies.plan })
      .from(companies)
      .where(eq(companies.id, owner.companyId));
    expect(company?.plan).toBe("essential");
    expect(await notices(owner.companyId)).toEqual([
      { template: "billing_payment_failed" },
    ]);
  });

  it("sends the day-5 notice once and downgrades without deleting data on expiry", async () => {
    const owner = await subscribedOwner("cus_grace");
    const series = await createSeries(database, owner.companyId, "invoice", {
      nextNumber: 4,
    });
    await seedIssuedDocuments(database, owner, {
      documentType: "invoice",
      seriesId: series,
      count: 3,
    });
    stripe.setSubscription("cus_grace", { status: "past_due" });
    const failedAt = new Date("2026-10-01T09:00:00.000Z");
    await reconcileSubscription(
      { companyId: owner.companyId },
      {
        database,
        stripe: stripe.client(),
        now: failedAt,
        paymentFailed: true,
      },
    );
    const emailQueue = recordingQueue();
    const dependencies = {
      database,
      stripe: stripe.client(),
      emailQueue,
    };

    const jobsQueue = recordingQueue();
    await planBillingGrace({
      database,
      queue: jobsQueue,
      now: new Date(failedAt.getTime() + 5 * DAY_MS + 60_000),
    });
    const planned = jobsQueue.messages.map((message) =>
      jobMessageSchema.parse(message),
    );
    expect(planned).toEqual([
      expect.objectContaining({
        type: "billing.grace",
        companyId: owner.companyId,
      }),
    ]);

    const dayFive = new Date(failedAt.getTime() + 5 * DAY_MS + 60_000);
    await handleBillingGrace(
      { companyId: owner.companyId },
      { ...dependencies, now: dayFive },
    );
    await handleBillingGrace(
      { companyId: owner.companyId },
      { ...dependencies, now: new Date(dayFive.getTime() + DAY_MS / 2) },
    );
    expect(await notices(owner.companyId)).toEqual([
      { template: "billing_grace_ending" },
    ]);
    expect(
      emailQueue.messages.map(
        (message) => emailSendMessageSchema.parse(message).type,
      ),
    ).toEqual(["email.send"]);

    const expired = new Date(failedAt.getTime() + 7 * DAY_MS + 60_000);
    await handleBillingGrace(
      { companyId: owner.companyId },
      { ...dependencies, now: expired },
    );

    const [company] = await database
      .select({ plan: companies.plan })
      .from(companies)
      .where(eq(companies.id, owner.companyId));
    expect(company?.plan).toBe("basic");
    expect(stripe.canceledSubscriptions).toHaveLength(1);
    const changes = await database
      .select({ toPlan: planChanges.toPlan, reason: planChanges.reason })
      .from(planChanges)
      .where(eq(planChanges.companyId, owner.companyId));
    expect(changes.at(-1)).toEqual({
      toPlan: "basic",
      reason: "grace_expired",
    });
    expect(
      (await notices(owner.companyId)).map(({ template }) => template),
    ).toEqual(["billing_grace_ending", "billing_downgraded"]);
    const [documentCount] = await database
      .select({ value: count() })
      .from(documents)
      .where(eq(documents.companyId, owner.companyId));
    expect(documentCount?.value).toBe(3);
  });

  it("clears the grace period when the renewal is paid", async () => {
    const owner = await subscribedOwner("cus_paid");
    stripe.setSubscription("cus_paid", { status: "past_due" });
    await reconcileSubscription(
      { companyId: owner.companyId },
      { database, stripe: stripe.client(), paymentFailed: true },
    );
    expect((await subscriptionRow(owner.companyId)).graceUntil).not.toBeNull();

    stripe.setSubscription("cus_paid", { status: "active" });
    await stripeWebhook(
      await signedWebhookRequest({
        id: "evt_paid",
        type: "invoice.paid",
        data: {
          object: { id: "in_p", object: "invoice", customer: "cus_paid" },
        },
      }),
    );

    const row = await subscriptionRow(owner.companyId);
    expect(row).toMatchObject({ status: "active", graceUntil: null });
  });
});

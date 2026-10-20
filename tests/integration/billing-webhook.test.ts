import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  billingEvents,
  billingPrices,
  companies,
  planChanges,
  subscriptions,
} from "@/db/schema";
import { setStripeClientFactory } from "@/services/billing/stripe";

import { createIntegrationDatabase } from "./database";
import { createOwner } from "./fixtures";
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

async function companyPlan(companyId: string) {
  const [company] = await database
    .select({ plan: companies.plan })
    .from(companies)
    .where(eq(companies.id, companyId));
  return company?.plan;
}

async function planChangesFor(companyId: string) {
  return database
    .select({
      fromPlan: planChanges.fromPlan,
      toPlan: planChanges.toPlan,
      reason: planChanges.reason,
      billingEventId: planChanges.billingEventId,
    })
    .from(planChanges)
    .where(eq(planChanges.companyId, companyId));
}

function checkoutCompleted(
  eventId: string,
  companyId: string,
  customer: string,
  subscription: string,
) {
  return {
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test",
        object: "checkout.session",
        mode: "subscription",
        client_reference_id: companyId,
        customer,
        subscription,
      },
    },
  };
}

function subscriptionEvent(
  eventId: string,
  type: string,
  customer: string,
  payloadStatus: string,
) {
  return {
    id: eventId,
    type,
    data: {
      object: {
        id: "sub_payload",
        object: "subscription",
        customer,
        status: payloadStatus,
      },
    },
  };
}

describe("Stripe webhook", () => {
  it("rejects an invalid signature with 400 and records nothing", async () => {
    const owner = await createOwner(database, { plan: "basic" });
    const request = await signedWebhookRequest(
      checkoutCompleted("evt_bad", owner.companyId, "cus_x", "sub_x"),
      "whsec_wrong_secret_value_000000",
    );

    const response = await stripeWebhook(request);

    expect(response.status).toBe(400);
    expect(await database.select().from(billingEvents)).toHaveLength(0);
    expect(await companyPlan(owner.companyId)).toBe("basic");
  });

  it("activates the plan from checkout by re-reading Stripe, once per event", async () => {
    const owner = await createOwner(database, { plan: "basic" });
    const customer = "cus_checkout";
    const subscription = stripe.setSubscription(customer, {
      lookupKey: "essential_monthly",
      status: "active",
    });
    const event = checkoutCompleted(
      "evt_checkout_1",
      owner.companyId,
      customer,
      subscription.id,
    );

    const first = await stripeWebhook(await signedWebhookRequest(event));
    const duplicate = await stripeWebhook(await signedWebhookRequest(event));

    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    expect(await companyPlan(owner.companyId)).toBe("essential");
    const [stored] = await database
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.companyId, owner.companyId));
    expect(stored).toMatchObject({
      stripeCustomerId: customer,
      stripeSubscriptionId: subscription.id,
      plan: "essential",
      interval: "month",
      status: "active",
      cancelAtPeriodEnd: false,
      graceUntil: null,
    });
    const changes = await planChangesFor(owner.companyId);
    expect(changes).toEqual([
      expect.objectContaining({
        fromPlan: "basic",
        toPlan: "essential",
        reason: "checkout",
      }),
    ]);
    const events = await database.select().from(billingEvents);
    expect(events).toHaveLength(1);
    expect(events[0]?.processedAt).not.toBeNull();
    expect(changes[0]?.billingEventId).toBe(events[0]?.id);
  });

  it("resolves out-of-order events from the current Stripe state", async () => {
    const owner = await createOwner(database, { plan: "basic" });
    const customer = "cus_order";
    const subscription = stripe.setSubscription(customer, {
      lookupKey: "pro_monthly",
      status: "active",
    });
    await stripeWebhook(
      await signedWebhookRequest(
        checkoutCompleted("evt_o1", owner.companyId, customer, subscription.id),
      ),
    );
    expect(await companyPlan(owner.companyId)).toBe("pro");

    // The subscription is canceled in Stripe, but an older "active" update
    // arrives after the deletion event: the payload must be ignored.
    stripe.setSubscription(customer, { status: "canceled" });
    await stripeWebhook(
      await signedWebhookRequest(
        subscriptionEvent(
          "evt_o3",
          "customer.subscription.deleted",
          customer,
          "canceled",
        ),
      ),
    );
    await stripeWebhook(
      await signedWebhookRequest(
        subscriptionEvent(
          "evt_o2",
          "customer.subscription.updated",
          customer,
          "active",
        ),
      ),
    );

    expect(await companyPlan(owner.companyId)).toBe("basic");
    const changes = await planChangesFor(owner.companyId);
    expect(changes.map((change) => [change.toPlan, change.reason])).toEqual([
      ["pro", "checkout"],
      ["basic", "canceled"],
    ]);
  });

  it("writes no plan change when an event does not change the effective plan", async () => {
    const owner = await createOwner(database, { plan: "basic" });
    const customer = "cus_steady";
    const subscription = stripe.setSubscription(customer);
    await stripeWebhook(
      await signedWebhookRequest(
        checkoutCompleted("evt_s1", owner.companyId, customer, subscription.id),
      ),
    );
    await stripeWebhook(
      await signedWebhookRequest({
        id: "evt_s2",
        type: "invoice.paid",
        data: { object: { id: "in_1", object: "invoice", customer } },
      }),
    );
    await stripeWebhook(
      await signedWebhookRequest(
        subscriptionEvent(
          "evt_s3",
          "customer.subscription.updated",
          customer,
          "active",
        ),
      ),
    );

    expect(await planChangesFor(owner.companyId)).toHaveLength(1);
    expect(await database.select().from(billingEvents)).toHaveLength(3);
  });

  it("syncs prices from price events without logging payloads", async () => {
    const response = await stripeWebhook(
      await signedWebhookRequest({
        id: "evt_price",
        type: "price.updated",
        data: {
          object: {
            id: stripe.priceId("essential_yearly"),
            object: "price",
          },
        },
      }),
    );

    expect(response.status).toBe(200);
    const [price] = await database
      .select()
      .from(billingPrices)
      .where(eq(billingPrices.lookupKey, "essential_yearly"));
    expect(price).toMatchObject({
      stripePriceId: stripe.priceId("essential_yearly"),
      plan: "essential",
      interval: "year",
      unitAmountCents: 9_000,
      currency: "eur",
      active: true,
    });
  });
});

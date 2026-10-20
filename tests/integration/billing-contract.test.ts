import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  billingPrices,
  companies,
  documents,
  subscriptions,
} from "@/db/schema";

import { createIntegrationDatabase } from "./database";
import {
  createDraft,
  createSeries,
  recordingQueue,
  seedIssuedDocuments,
} from "./fixtures";
import {
  APP_BASE_URL,
  authenticatedRequest,
  createTenant,
  jsonBody,
  type Tenant,
} from "./http";
import { FakeStripe } from "./stripe-fake";

process.env.BETTER_AUTH_SECRET =
  "invoice-flash-contract-secret-at-least-thirty-two-characters";
process.env.BETTER_AUTH_URL = APP_BASE_URL;
process.env.APP_BASE_URL = APP_BASE_URL;

const database = createIntegrationDatabase();
vi.mock("@/db", () => ({ createDatabase: () => database }));
vi.mock("@/db/index", () => ({ createDatabase: () => database }));

const { auth, setAuthEmailDeliveryHandler } = await import("@/lib/auth");
const { setStripeClientFactory } = await import("@/services/billing/stripe");
const { GET: getPlans } = await import("@/app/api/v1/billing/plans/route");
const { GET: getSubscription } = await import(
  "@/app/api/v1/billing/subscription/route"
);
const { POST: postCheckout } = await import(
  "@/app/api/v1/billing/checkout/route"
);
const { POST: postPortal } = await import("@/app/api/v1/billing/portal/route");
const { completeCheckoutReturn } = await import(
  "@/services/billing/checkout-return"
);

let stripe: FakeStripe;
let owner: Tenant;

async function seedPrices() {
  await database.insert(billingPrices).values([
    {
      lookupKey: "essential_monthly",
      stripePriceId: stripe.priceId("essential_monthly"),
      plan: "essential",
      interval: "month",
      unitAmountCents: 900,
      currency: "eur",
    },
    {
      lookupKey: "essential_yearly",
      stripePriceId: stripe.priceId("essential_yearly"),
      plan: "essential",
      interval: "year",
      unitAmountCents: 9_000,
      currency: "eur",
    },
    {
      lookupKey: "pro_monthly",
      stripePriceId: stripe.priceId("pro_monthly"),
      plan: "pro",
      interval: "month",
      unitAmountCents: 1_900,
      currency: "eur",
    },
  ]);
}

function checkout(body: unknown, idempotencyKey?: string): Request {
  return authenticatedRequest(owner, "/api/v1/billing/checkout", {
    method: "POST",
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  stripe = new FakeStripe();
  setStripeClientFactory(() => stripe.client());
  setAuthEmailDeliveryHandler(() => Promise.resolve());
  process.env.PRO_CHECKOUT_ENABLED = "false";
  owner = await createTenant(auth, database, "basic");
  await seedPrices();
});

afterEach(() => {
  setStripeClientFactory(null);
});

describe("billing contract", () => {
  it("lists the three plans with prices, per-type limits, features and the current plan", async () => {
    const response = await getPlans(
      authenticatedRequest(owner, "/api/v1/billing/plans"),
    );
    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    const plans = body.plans as Array<Record<string, unknown>>;

    expect(plans.map((plan) => plan.plan)).toEqual([
      "basic",
      "essential",
      "pro",
    ]);
    expect(plans[0]).toMatchObject({
      label: "Básico",
      current: true,
      purchasable: false,
      prices: [],
      limits: expect.arrayContaining([{ document_type: "invoice", limit: 5 }]),
      features: [],
    });
    expect(plans[1]).toMatchObject({
      label: "Esencial",
      current: false,
      purchasable: true,
      features: ["email", "period_export"],
      prices: expect.arrayContaining([
        {
          lookup_key: "essential_monthly",
          interval: "month",
          unit_amount_cents: 900,
          currency: "eur",
        },
      ]),
    });
    expect(plans[2]).toMatchObject({ plan: "pro", purchasable: false });
  });

  it("requires a session for the plans page", async () => {
    const response = await getPlans(
      new Request(`${APP_BASE_URL}/api/v1/billing/plans`),
    );
    expect(response.status).toBe(401);
  });

  it("returns the owner's subscription state, basic without one", async () => {
    const response = await getSubscription(
      authenticatedRequest(owner, "/api/v1/billing/subscription"),
    );
    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({
      plan: "basic",
      effective_plan: "basic",
      interval: null,
      status: null,
      current_period_end: null,
      cancel_at_period_end: false,
      grace_until: null,
    });
  });

  it("requires an Idempotency-Key for checkout", async () => {
    const response = await postCheckout(
      checkout({ lookup_key: "essential_monthly" }),
    );
    expect(response.status).toBe(400);
    expect((await jsonBody(response)).error).toMatchObject({
      code: "idempotency_key_invalid",
    });
  });

  it("creates a Checkout session reusing one Stripe customer", async () => {
    const draftId = crypto.randomUUID();
    const first = await postCheckout(
      checkout(
        { lookup_key: "essential_monthly", resume_document_id: draftId },
        crypto.randomUUID(),
      ),
    );
    const second = await postCheckout(
      checkout({ lookup_key: "essential_yearly" }, crypto.randomUUID()),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await jsonBody(first)).url).toMatch(
      /^https:\/\/checkout\.stripe\.test\//,
    );
    expect(stripe.customers.size).toBe(1);
    const sessions = [...stripe.checkoutSessions.values()];
    expect(sessions).toHaveLength(2);
    const params = sessions[0]?.params;
    expect(params).toMatchObject({
      mode: "subscription",
      client_reference_id: owner.companyId,
      billing_address_collection: "required",
      tax_id_collection: { enabled: true },
      line_items: [{ price: stripe.priceId("essential_monthly"), quantity: 1 }],
    });
    expect(params?.success_url).toBe(
      `${APP_BASE_URL}/billing/return?session_id={CHECKOUT_SESSION_ID}&resume=${draftId}`,
    );
    const [row] = await database
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.companyId, owner.companyId));
    expect(row).toMatchObject({ status: "incomplete", plan: "basic" });
  });

  it("rejects Pro while PRO_CHECKOUT_ENABLED is off", async () => {
    const response = await postCheckout(
      checkout({ lookup_key: "pro_monthly" }, crypto.randomUUID()),
    );
    expect(response.status).toBe(403);
    expect((await jsonBody(response)).error).toMatchObject({
      code: "plan_not_available",
    });

    process.env.PRO_CHECKOUT_ENABLED = "true";
    const enabled = await postCheckout(
      checkout({ lookup_key: "pro_monthly" }, crypto.randomUUID()),
    );
    expect(enabled.status).toBe(200);
  });

  it("sends an existing subscriber to the Portal plan-change flow", async () => {
    await postCheckout(
      checkout({ lookup_key: "essential_monthly" }, crypto.randomUUID()),
    );
    const [session] = [...stripe.checkoutSessions.keys()];
    const subscription = stripe.completeCheckout(session as string);
    await database
      .update(subscriptions)
      .set({
        stripeSubscriptionId: subscription.id,
        status: "active",
        plan: "essential",
      })
      .where(eq(subscriptions.companyId, owner.companyId));

    const response = await postCheckout(
      checkout({ lookup_key: "essential_yearly" }, crypto.randomUUID()),
    );

    expect(response.status).toBe(200);
    expect((await jsonBody(response)).url).toBe(
      "https://billing.stripe.test/session",
    );
    expect(stripe.portalSessions.at(-1)).toMatchObject({
      flow_data: {
        type: "subscription_update_confirm",
        subscription_update_confirm: {
          subscription: subscription.id,
          items: [
            {
              id: `si_${subscription.id}`,
              price: stripe.priceId("essential_yearly"),
            },
          ],
        },
      },
    });
  });

  it("opens the Customer Portal only for an existing customer", async () => {
    const before = await postPortal(
      authenticatedRequest(owner, "/api/v1/billing/portal", { method: "POST" }),
    );
    expect(before.status).toBe(409);

    await postCheckout(
      checkout({ lookup_key: "essential_monthly" }, crypto.randomUUID()),
    );
    const after = await postPortal(
      authenticatedRequest(owner, "/api/v1/billing/portal", { method: "POST" }),
    );
    expect(after.status).toBe(200);
    expect(await jsonBody(after)).toEqual({
      url: "https://billing.stripe.test/session",
    });
    expect(stripe.portalSessions.at(-1)?.return_url).toBe(
      `${APP_BASE_URL}/settings#subscription`,
    );
  });
});

describe("Checkout return", () => {
  it("activates the plan and issues the blocked draft without redoing it", async () => {
    const series = await createSeries(database, owner.companyId, "invoice", {
      nextNumber: 6,
    });
    await seedIssuedDocuments(database, owner, {
      documentType: "invoice",
      seriesId: series,
      count: 5,
      issuedAt: new Date(),
    });
    const draftId = await createDraft(database, owner, {
      now: new Date(),
      issueDate: new Date().toISOString().slice(0, 10),
    });
    await postCheckout(
      checkout(
        { lookup_key: "essential_monthly", resume_document_id: draftId },
        crypto.randomUUID(),
      ),
    );
    const [sessionId] = [...stripe.checkoutSessions.keys()];
    stripe.completeCheckout(sessionId as string);
    const pdfQueue = recordingQueue();

    const outcome = await completeCheckoutReturn(
      {
        companyId: owner.companyId,
        userId: owner.userId,
        sessionId: sessionId as string,
        resumeDocumentId: draftId,
      },
      { database, stripe: stripe.client(), pdfQueue, notify: false },
    );

    expect(outcome).toEqual({ kind: "issued", documentId: draftId });
    const [company] = await database
      .select({ plan: companies.plan })
      .from(companies)
      .where(eq(companies.id, owner.companyId));
    expect(company?.plan).toBe("essential");
    const [draft] = await database
      .select({ status: documents.status, number: documents.number })
      .from(documents)
      .where(eq(documents.id, draftId));
    expect(draft).toEqual({ status: "issued", number: 6 });
    expect(pdfQueue.messages).toHaveLength(1);
  });

  it("keeps an abandoned checkout's draft numberless and rejects foreign sessions", async () => {
    const other = await createTenant(auth, database, "basic");
    const draftId = await createDraft(database, owner, {
      now: new Date(),
      issueDate: new Date().toISOString().slice(0, 10),
    });
    await postCheckout(
      checkout(
        { lookup_key: "essential_monthly", resume_document_id: draftId },
        crypto.randomUUID(),
      ),
    );
    const [sessionId] = [...stripe.checkoutSessions.keys()];

    const foreign = await completeCheckoutReturn(
      {
        companyId: other.companyId,
        userId: other.userId,
        sessionId: sessionId as string,
        resumeDocumentId: draftId,
      },
      {
        database,
        stripe: stripe.client(),
        pdfQueue: recordingQueue(),
        notify: false,
      },
    );
    expect(foreign).toEqual({ kind: "invalid_session" });

    const [draft] = await database
      .select({ status: documents.status, number: documents.number })
      .from(documents)
      .where(eq(documents.id, draftId));
    expect(draft).toEqual({ status: "draft", number: null });
  });
});

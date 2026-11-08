import { expect, type Page, test } from "@playwright/test";
import Stripe from "stripe";

import {
  registerVerifyAndSignIn,
  saveFiscalData,
  withDatabase,
} from "./helpers";

/**
 * Quickstart V2.5, V2.7 and V2.8 (specs/002, T189) against staging: real
 * Stripe sandbox, real webhooks and a Stripe test clock per company. Local
 * runs have no public webhook endpoint, so this file only runs when
 * E2E_BASE_URL points at staging and E2E_STRIPE_SECRET_KEY is set.
 *
 * The 7-day grace period runs on the app's own clock, not Stripe's, so its
 * day-5 notice and expiry stay covered by tests/integration/billing-grace.
 */
const staging =
  (process.env.E2E_BASE_URL ?? "").includes("staging") &&
  Boolean(process.env.E2E_STRIPE_SECRET_KEY);
test.skip(!staging, "Solo contra staging con la clave de Stripe de prueba.");

const DAY = 24 * 60 * 60;

function stripe(): Stripe {
  return new Stripe(process.env.E2E_STRIPE_SECRET_KEY ?? "");
}

async function priceId(lookupKey: string): Promise<string> {
  return withDatabase(async (database) => {
    const [row] = await database<{ stripe_price_id: string }[]>`
      SELECT stripe_price_id FROM billing_price WHERE lookup_key = ${lookupKey}
    `;
    if (!row) throw new Error(`Falta el precio ${lookupKey}`);
    return row.stripe_price_id;
  });
}

async function companyIdOf(email: string): Promise<string> {
  return withDatabase(async (database) => {
    const [row] = await database<{ id: string }[]>`
      SELECT company.id FROM company
      JOIN "user" ON "user".id = company.user_id
      WHERE "user".email = ${email}
    `;
    if (!row) throw new Error("Sin empresa");
    return row.id;
  });
}

interface CompanyState {
  plan: string;
  status: string | null;
  interval: string | null;
  cancel_at_period_end: boolean | null;
  grace_until: Date | null;
  plan_changes: number;
  documents: number;
}

async function companyState(companyId: string): Promise<CompanyState> {
  return withDatabase(async (database) => {
    const [row] = await database<CompanyState[]>`
      SELECT company.plan::text AS plan,
        subscription.status::text AS status,
        subscription.interval::text AS interval,
        subscription.cancel_at_period_end,
        subscription.grace_until,
        (SELECT count(*)::int FROM plan_change WHERE company_id = company.id) AS plan_changes,
        (SELECT count(*)::int FROM document WHERE company_id = company.id) AS documents
      FROM company
      LEFT JOIN subscription ON subscription.company_id = company.id
      WHERE company.id = ${companyId}
    `;
    if (!row) throw new Error("Sin empresa");
    return row;
  });
}

async function waitForState(
  companyId: string,
  predicate: (state: CompanyState) => boolean,
): Promise<CompanyState> {
  let last: CompanyState | undefined;
  await expect
    .poll(
      async () => {
        last = await companyState(companyId);
        return predicate(last);
      },
      { timeout: 90_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBe(true);
  return last as CompanyState;
}

/** A real navigation: a `#` change on /settings would keep the stale page. */
async function openSubscription(page: Page): Promise<void> {
  await page.goto(`/settings?at=${Date.now()}`);
  await expect(
    page.getByRole("heading", { name: "Suscripción" }),
  ).toBeVisible();
}

async function advanceClock(clockId: string, to: number): Promise<void> {
  await stripe().testHelpers.testClocks.advance(clockId, { frozen_time: to });
  await expect
    .poll(
      async () =>
        (await stripe().testHelpers.testClocks.retrieve(clockId)).status,
      { timeout: 120_000, intervals: [2_000, 5_000] },
    )
    .toBe("ready");
}

/**
 * A staging company subscribed to Esencial through a test-clock customer.
 * The subscription row is written the same way the app's checkout writes it
 * before redirecting to Stripe; from there on only webhooks change it.
 */
async function subscribedCompany(
  page: Page,
  paymentMethod: string,
): Promise<{ companyId: string; clockId: string; subscriptionId: string }> {
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);
  const companyId = await companyIdOf(email);

  const now = Math.floor(Date.now() / 1000);
  const clock = await stripe().testHelpers.testClocks.create({
    frozen_time: now,
    name: `T189 ${companyId}`,
  });
  const customer = await stripe().customers.create({
    email,
    test_clock: clock.id,
    metadata: { company_id: companyId },
  });
  const method = await stripe().paymentMethods.attach(paymentMethod, {
    customer: customer.id,
  });
  await stripe().customers.update(customer.id, {
    invoice_settings: { default_payment_method: method.id },
  });
  await withDatabase(async (database) => {
    await database`
      INSERT INTO subscription (id, company_id, stripe_customer_id, plan, status, last_synced_at, created_at, updated_at)
      VALUES (${crypto.randomUUID()}, ${companyId}, ${customer.id}, 'basic', 'incomplete', now(), now(), now())
    `;
  });
  const subscription = await stripe().subscriptions.create({
    customer: customer.id,
    items: [{ price: await priceId("essential_monthly") }],
    ...(process.env.E2E_STRIPE_TAX_RATE_ID
      ? { default_tax_rates: [process.env.E2E_STRIPE_TAX_RATE_ID] }
      : {}),
    metadata: { company_id: companyId },
  });
  await waitForState(
    companyId,
    (state) => state.plan === "essential" && state.status === "active",
  );
  return { companyId, clockId: clock.id, subscriptionId: subscription.id };
}

test("V2.5 y V2.7: reentregar el webhook no duplica; anual, cancelación y paso a Básico al final del periodo", async ({
  page,
}) => {
  test.setTimeout(600_000);
  const { companyId, clockId, subscriptionId } = await subscribedCompany(
    page,
    "pm_card_visa",
  );
  const subscribed = await companyState(companyId);
  expect(subscribed.plan_changes).toBe(1);

  // V2.5: Stripe re-delivers the activation event; no second plan_change.
  const [event] = (
    await stripe().events.list({
      type: "customer.subscription.created",
      limit: 20,
    })
  ).data.filter(
    (item) => (item.data.object as Stripe.Subscription).id === subscriptionId,
  );
  expect(event).toBeDefined();
  const endpoint = (
    await stripe().webhookEndpoints.list({ limit: 20 })
  ).data.find((item) => item.url.startsWith(process.env.E2E_BASE_URL ?? "-"));
  expect(endpoint).toBeDefined();
  const resend = await stripe().rawRequest(
    "POST",
    `/v1/events/${event?.id}/retry`,
    { webhook_endpoint: endpoint?.id },
  );
  expect(resend.lastResponse.statusCode).toBe(200);
  await page.waitForTimeout(10_000);
  expect((await companyState(companyId)).plan_changes).toBe(1);

  // V2.7: switch to yearly (what the portal's plan change does).
  const current = await stripe().subscriptions.retrieve(subscriptionId);
  await stripe().subscriptions.update(subscriptionId, {
    items: [
      {
        id: current.items.data[0]?.id,
        price: await priceId("essential_yearly"),
      },
    ],
    proration_behavior: "always_invoice",
  });
  await waitForState(companyId, (state) => state.interval === "year");
  await openSubscription(page);
  await expect(page.getByText("Anual")).toBeVisible();

  // Cancel at period end: still Esencial, with the end date shown.
  await stripe().subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  });
  const cancelled = await waitForState(
    companyId,
    (state) => state.cancel_at_period_end === true,
  );
  expect(cancelled.plan).toBe("essential");
  await openSubscription(page);
  await expect(page.getByText("Termina el")).toBeVisible();

  // Past the period end the subscription ends: Básico, nothing deleted.
  const updated = await stripe().subscriptions.retrieve(subscriptionId);
  const periodEnd =
    updated.items.data[0]?.current_period_end ??
    Math.floor(Date.now() / 1000) + 366 * DAY;
  await advanceClock(clockId, periodEnd + DAY);
  const ended = await waitForState(
    companyId,
    (state) => state.plan === "basic",
  );
  expect(ended.documents).toBe(subscribed.documents);
  expect(ended.plan_changes).toBe(2);
  await openSubscription(page);
  await expect(page.getByText("Básico").first()).toBeVisible();

  await stripe().testHelpers.testClocks.del(clockId);
});

test("V2.8: una renovación fallida abre la gracia de 7 días y mantiene el plan", async ({
  page,
}) => {
  test.setTimeout(600_000);
  const { companyId, clockId, subscriptionId } = await subscribedCompany(
    page,
    "pm_card_visa",
  );

  // From now on every charge fails (card 4000 0000 0000 0341).
  const failing = await stripe().paymentMethods.attach(
    "pm_card_chargeCustomerFail",
    {
      customer: (await stripe().subscriptions.retrieve(subscriptionId))
        .customer as string,
    },
  );
  await stripe().subscriptions.update(subscriptionId, {
    default_payment_method: failing.id,
  });
  const subscription = await stripe().subscriptions.retrieve(subscriptionId);
  const periodEnd = subscription.items.data[0]?.current_period_end ?? 0;
  await advanceClock(clockId, periodEnd + 2 * 60 * 60);

  const grace = await waitForState(
    companyId,
    (state) => state.status === "past_due" && state.grace_until !== null,
  );
  expect(grace.plan).toBe("essential");
  const days =
    ((grace.grace_until?.getTime() ?? 0) - Date.now()) / (DAY * 1000);
  expect(days).toBeGreaterThan(6.9);
  expect(days).toBeLessThanOrEqual(7);

  await openSubscription(page);
  await expect(
    page.getByText(/No hemos podido cobrar la renovación/),
  ).toBeVisible();

  await stripe().testHelpers.testClocks.del(clockId);
});

import { and, eq } from "drizzle-orm";

import type { Database } from "@/db";
import { billingPrices } from "@/db/schema/billing-price";
import { companies } from "@/db/schema/company";
import { subscriptions } from "@/db/schema/subscription";
import { ApiError } from "@/lib/api/errors";
import { isLookupKey, parseLookupKey } from "@/lib/billing-plan";
import { createUuidV7 } from "@/lib/ids";
import type { StripeClient } from "@/services/billing/stripe";

export interface BillingSessionDependencies {
  database: Database;
  stripe: StripeClient;
  appBaseUrl: string;
  now?: Date;
}

const SUBSCRIBED_STATUSES = new Set(["active", "past_due"]);

function planNotAvailable(): ApiError {
  return new ApiError(
    "plan_not_available",
    403,
    "El plan Pro estará disponible próximamente.",
  );
}

async function loadSubscription(database: Database, companyId: string) {
  const [row] = await database
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.companyId, companyId))
    .limit(1);
  return row;
}

/**
 * One Stripe customer per company: created with an idempotency key derived
 * from the company and recorded as an `incomplete` subscription row until
 * Checkout completes (the effective plan stays Basic meanwhile).
 */
async function ensureCustomer(
  dependencies: BillingSessionDependencies,
  companyId: string,
): Promise<string> {
  const { database, stripe } = dependencies;
  const existing = await loadSubscription(database, companyId);
  if (existing) {
    return existing.stripeCustomerId;
  }
  const [company] = await database
    .select({
      email: companies.email,
      legalName: companies.legalName,
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (!company) {
    throw new ApiError(
      "resource_not_found",
      404,
      "No se ha encontrado la empresa.",
    );
  }
  const customer = await stripe.customers.create(
    {
      email: company.email,
      name: company.legalName ?? undefined,
      preferred_locales: ["es"],
      metadata: { company_id: companyId },
    },
    { idempotencyKey: `factum-customer:${companyId}` },
  );
  const now = dependencies.now ?? new Date();
  await database
    .insert(subscriptions)
    .values({
      id: createUuidV7(now.getTime()),
      companyId,
      stripeCustomerId: customer.id,
      plan: "basic",
      status: "incomplete",
      lastSyncedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: subscriptions.companyId });
  const winner = await loadSubscription(database, companyId);
  return winner?.stripeCustomerId ?? customer.id;
}

/**
 * Checkout for a new subscriber, or the Portal plan-change flow for an
 * existing one (contracts/api.md `POST /billing/checkout`).
 */
export async function createCheckoutSession(
  input: {
    companyId: string;
    lookupKey: string;
    resumeDocumentId?: string;
    idempotencyKey: string;
    proCheckoutEnabled: boolean;
    taxRateId?: string;
  },
  dependencies: BillingSessionDependencies,
): Promise<{ url: string }> {
  const lookup = isLookupKey(input.lookupKey)
    ? parseLookupKey(input.lookupKey)
    : null;
  if (!lookup) {
    throw new ApiError("validation_error", 400, "El plan elegido no existe.", {
      lookup_key: "Elige un plan y una periodicidad válidos.",
    });
  }
  if (lookup.plan === "pro" && !input.proCheckoutEnabled) {
    throw planNotAvailable();
  }
  const { database, stripe, appBaseUrl } = dependencies;
  const [price] = await database
    .select({ stripePriceId: billingPrices.stripePriceId })
    .from(billingPrices)
    .where(
      and(
        eq(billingPrices.lookupKey, input.lookupKey),
        eq(billingPrices.active, true),
      ),
    )
    .limit(1);
  if (!price) {
    throw new ApiError(
      "conflict",
      409,
      "Este precio no está disponible ahora mismo. Inténtalo más tarde.",
    );
  }

  const subscription = await loadSubscription(database, input.companyId);
  if (
    subscription?.stripeSubscriptionId &&
    SUBSCRIBED_STATUSES.has(subscription.status)
  ) {
    const current = await stripe.subscriptions.retrieve(
      subscription.stripeSubscriptionId,
    );
    const item = current.items.data[0];
    if (!item) {
      throw new ApiError(
        "conflict",
        409,
        "No se ha podido leer tu suscripción. Gestiónala desde el portal.",
      );
    }
    const portal = await stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${appBaseUrl}/billing`,
      flow_data: {
        type: "subscription_update_confirm",
        subscription_update_confirm: {
          subscription: subscription.stripeSubscriptionId,
          items: [{ id: item.id, price: price.stripePriceId, quantity: 1 }],
        },
        after_completion: {
          type: "redirect",
          redirect: { return_url: `${appBaseUrl}/billing?updated=1` },
        },
      },
    });
    return { url: portal.url };
  }

  const customer = await ensureCustomer(dependencies, input.companyId);
  const resume = input.resumeDocumentId
    ? `&resume=${encodeURIComponent(input.resumeDocumentId)}`
    : "";
  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      customer,
      client_reference_id: input.companyId,
      line_items: [
        {
          price: price.stripePriceId,
          quantity: 1,
          ...(input.taxRateId ? { tax_rates: [input.taxRateId] } : {}),
        },
      ],
      billing_address_collection: "required",
      tax_id_collection: { enabled: true, required: "if_supported" },
      customer_update: { address: "auto", name: "auto" },
      locale: "es",
      success_url: `${appBaseUrl}/billing/return?session_id={CHECKOUT_SESSION_ID}${resume}`,
      cancel_url: `${appBaseUrl}/billing?canceled=1`,
      metadata: { company_id: input.companyId },
    },
    {
      idempotencyKey: `factum-checkout:${input.companyId}:${input.idempotencyKey}`,
    },
  );
  if (!session.url) {
    throw new ApiError("internal_error", 500, "No se ha podido abrir el pago.");
  }
  return { url: session.url };
}

/** Customer Portal: plan/interval changes, payment method, invoices, cancel. */
export async function createPortalSession(
  companyId: string,
  dependencies: BillingSessionDependencies,
): Promise<{ url: string }> {
  const subscription = await loadSubscription(dependencies.database, companyId);
  if (!subscription) {
    throw new ApiError(
      "conflict",
      409,
      "Todavía no tienes una suscripción. Elige un plan para empezar.",
    );
  }
  const session = await dependencies.stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: `${dependencies.appBaseUrl}/settings#subscription`,
  });
  return { url: session.url };
}

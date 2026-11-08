import Stripe from "stripe";

import type { StripeClient } from "@/services/billing/stripe";

export const TEST_WEBHOOK_SECRET = "whsec_test_factum_0123456789abcdef";

type LookupKey =
  | "essential_monthly"
  | "essential_yearly"
  | "pro_monthly"
  | "pro_yearly";

interface FakeSubscriptionState {
  id: string;
  customer: string;
  status: Stripe.Subscription.Status;
  lookupKey: LookupKey;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
  created: number;
}

interface FakePrice {
  id: string;
  lookupKey: LookupKey;
  unitAmount: number;
  active: boolean;
  productActive: boolean;
}

const PRICE_IDS: Record<LookupKey, string> = {
  essential_monthly: "price_essential_monthly",
  essential_yearly: "price_essential_yearly",
  pro_monthly: "price_pro_monthly",
  pro_yearly: "price_pro_yearly",
};

/**
 * In-memory Stripe implementing only what the billing services call. State
 * is the "truth" the reconciliation re-reads, so tests can make a webhook
 * payload disagree with it to prove payloads are never applied directly.
 */
export class FakeStripe {
  customers: Map<string, { id: string; email?: string | null }> = new Map();
  subscriptions: Map<string, FakeSubscriptionState> = new Map();
  prices: Map<string, FakePrice> = new Map();
  checkoutSessions: Map<
    string,
    {
      params: Stripe.Checkout.SessionCreateParams;
      session: Stripe.Checkout.Session;
    }
  > = new Map();
  portalSessions: Stripe.BillingPortal.SessionCreateParams[] = [];
  canceledSubscriptions: string[] = [];
  private customerByIdempotencyKey = new Map<string, string>();
  private counter = 0;

  constructor() {
    for (const [lookupKey, id] of Object.entries(PRICE_IDS) as Array<
      [LookupKey, string]
    >) {
      this.prices.set(id, {
        id,
        lookupKey,
        unitAmount: lookupKey.startsWith("essential")
          ? lookupKey.endsWith("monthly")
            ? 900
            : 9_000
          : lookupKey.endsWith("monthly")
            ? 1_900
            : 19_000,
        active: true,
        productActive: true,
      });
    }
  }

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}_${this.counter.toString().padStart(6, "0")}`;
  }

  priceId(lookupKey: LookupKey): string {
    return PRICE_IDS[lookupKey];
  }

  setSubscription(
    customer: string,
    state: Partial<Omit<FakeSubscriptionState, "customer">> = {},
  ): FakeSubscriptionState {
    const existing = [...this.subscriptions.values()].find(
      (subscription) => subscription.customer === customer,
    );
    const subscription: FakeSubscriptionState = {
      id: existing?.id ?? this.nextId("sub"),
      customer,
      status: "active",
      lookupKey: "essential_monthly",
      currentPeriodEnd: Math.floor(Date.UTC(2026, 10, 20) / 1_000),
      cancelAtPeriodEnd: false,
      created: Math.floor(Date.now() / 1_000),
      ...existing,
      ...state,
    };
    this.subscriptions.set(subscription.id, subscription);
    return subscription;
  }

  private subscriptionObject(
    state: FakeSubscriptionState,
  ): Stripe.Subscription {
    const price = this.priceObject(PRICE_IDS[state.lookupKey]);
    return {
      id: state.id,
      object: "subscription",
      customer: state.customer,
      status: state.status,
      cancel_at_period_end: state.cancelAtPeriodEnd,
      created: state.created,
      items: {
        object: "list",
        data: [
          {
            id: `si_${state.id}`,
            object: "subscription_item",
            price,
            current_period_end: state.currentPeriodEnd,
          },
        ],
      },
    } as unknown as Stripe.Subscription;
  }

  private priceObject(id: string): Stripe.Price {
    const price = this.prices.get(id);
    if (!price) {
      throw new Error(`No such price: ${id}`);
    }
    return {
      id: price.id,
      object: "price",
      active: price.active,
      currency: "eur",
      lookup_key: price.lookupKey,
      unit_amount: price.unitAmount,
      recurring: {
        interval: price.lookupKey.endsWith("monthly") ? "month" : "year",
      },
      product: {
        id: `prod_${price.lookupKey.split("_")[0]}`,
        object: "product",
        active: price.productActive,
      },
    } as unknown as Stripe.Price;
  }

  client(): StripeClient {
    return {
      customers: {
        create: async (
          params: Stripe.CustomerCreateParams,
          options?: Stripe.RequestOptions,
        ) => {
          const key = options?.idempotencyKey;
          const reused = key
            ? this.customerByIdempotencyKey.get(key)
            : undefined;
          if (reused) {
            return { id: reused, object: "customer" };
          }
          const id = this.nextId("cus");
          this.customers.set(id, { id, email: params.email });
          if (key) {
            this.customerByIdempotencyKey.set(key, id);
          }
          return { id, object: "customer" };
        },
      },
      subscriptions: {
        list: async (params: Stripe.SubscriptionListParams) => ({
          object: "list",
          has_more: false,
          data: [...this.subscriptions.values()]
            .filter((subscription) => subscription.customer === params.customer)
            .sort((left, right) => right.created - left.created)
            .map((subscription) => this.subscriptionObject(subscription)),
        }),
        retrieve: async (id: string) => {
          const state = this.subscriptions.get(id);
          if (!state) {
            throw new Error(`No such subscription: ${id}`);
          }
          return this.subscriptionObject(state);
        },
        cancel: async (id: string) => {
          const state = this.subscriptions.get(id);
          if (!state) {
            throw new Error(`No such subscription: ${id}`);
          }
          state.status = "canceled";
          this.canceledSubscriptions.push(id);
          return this.subscriptionObject(state);
        },
      },
      prices: {
        retrieve: async (id: string) => this.priceObject(id),
        list: async (params: Stripe.PriceListParams) => ({
          object: "list",
          has_more: false,
          data: [...this.prices.values()]
            .filter(
              (price) =>
                !params.product ||
                `prod_${price.lookupKey.split("_")[0]}` === params.product,
            )
            .map((price) => this.priceObject(price.id)),
        }),
      },
      checkout: {
        sessions: {
          create: async (params: Stripe.Checkout.SessionCreateParams) => {
            const id = this.nextId("cs");
            const session = {
              id,
              object: "checkout.session",
              url: `https://checkout.stripe.test/${id}`,
              customer: params.customer ?? null,
              client_reference_id: params.client_reference_id ?? null,
              status: "open",
              subscription: null,
            } as unknown as Stripe.Checkout.Session;
            this.checkoutSessions.set(id, { params, session });
            return session;
          },
          retrieve: async (id: string) => {
            const entry = this.checkoutSessions.get(id);
            if (!entry) {
              throw new Error(`No such checkout session: ${id}`);
            }
            return entry.session;
          },
        },
      },
      billingPortal: {
        sessions: {
          create: async (params: Stripe.BillingPortal.SessionCreateParams) => {
            this.portalSessions.push(params);
            return {
              id: this.nextId("bps"),
              object: "billing_portal.session",
              url: "https://billing.stripe.test/session",
            };
          },
        },
      },
    } as unknown as StripeClient;
  }

  /** Marks a checkout session as completed with its subscription. */
  completeCheckout(sessionId: string): FakeSubscriptionState {
    const entry = this.checkoutSessions.get(sessionId);
    if (!entry) {
      throw new Error(`No such checkout session: ${sessionId}`);
    }
    const customer = String(entry.params.customer);
    const priceId = entry.params.line_items?.[0]?.price;
    const lookupKey = (Object.entries(PRICE_IDS).find(
      ([, id]) => id === priceId,
    )?.[0] ?? "essential_monthly") as LookupKey;
    const subscription = this.setSubscription(customer, {
      lookupKey,
      status: "active",
    });
    (entry.session as unknown as Record<string, unknown>).status = "complete";
    (entry.session as unknown as Record<string, unknown>).subscription =
      subscription.id;
    return subscription;
  }
}

/** Builds a signed webhook request for the route handler. */
export async function signedWebhookRequest(
  event: {
    id: string;
    type: string;
    data: { object: Record<string, unknown> };
  },
  secret = TEST_WEBHOOK_SECRET,
): Promise<Request> {
  const payload = JSON.stringify({
    object: "event",
    api_version: "2026-09-30.endive",
    created: Math.floor(Date.now() / 1_000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    ...event,
  });
  const signature = await Stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret,
    cryptoProvider: Stripe.createSubtleCryptoProvider(),
  });
  return new Request("http://localhost:3000/api/webhooks/stripe", {
    method: "POST",
    headers: {
      "Stripe-Signature": signature,
      "Content-Type": "application/json",
    },
    body: payload,
  });
}

import { eq } from "drizzle-orm";
import type Stripe from "stripe";

import { createDatabase, type Database } from "@/db";
import { billingEvents } from "@/db/schema/billing-event";
import { billingPrices } from "@/db/schema/billing-price";
import { createUuidV7 } from "@/lib/ids";
import { logSafe } from "@/lib/log";
import {
  notifyPaymentFailed,
  notifyPlanChange,
} from "@/services/billing/notify";
import { syncPrice, syncProductPrices } from "@/services/billing/prices";
import { reconcileSubscription } from "@/services/billing/reconcile";
import {
  InvalidWebhookSignatureError,
  verifyStripeWebhook,
} from "@/services/billing/stripe";

function customerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): string | null {
  if (!customer) {
    return null;
  }
  return typeof customer === "string" ? customer : customer.id;
}

async function dispatch(
  event: Stripe.Event,
  database: Database,
  billingEventId: string,
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const customer = customerId(session.customer);
      if (
        session.mode !== "subscription" ||
        !session.client_reference_id ||
        !customer
      ) {
        return;
      }
      const result = await reconcileSubscription(
        { companyId: session.client_reference_id, stripeCustomerId: customer },
        { database, reason: "checkout", billingEventId },
      );
      await notifyPlanChange(database, result);
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const customer = customerId(event.data.object.customer);
      if (!customer) {
        return;
      }
      const result = await reconcileSubscription(
        { stripeCustomerId: customer },
        { database, reason: "portal", billingEventId },
      );
      await notifyPlanChange(database, result);
      return;
    }
    case "invoice.paid": {
      const customer = customerId(event.data.object.customer);
      if (!customer) {
        return;
      }
      const result = await reconcileSubscription(
        { stripeCustomerId: customer },
        { database, reason: "portal", billingEventId },
      );
      await notifyPlanChange(database, result);
      return;
    }
    case "invoice.payment_failed": {
      const customer = customerId(event.data.object.customer);
      if (!customer) {
        return;
      }
      const result = await reconcileSubscription(
        { stripeCustomerId: customer },
        {
          database,
          reason: "renewal_failed",
          billingEventId,
          paymentFailed: true,
        },
      );
      await notifyPaymentFailed(database, result);
      await notifyPlanChange(database, result);
      return;
    }
    case "price.created":
    case "price.updated":
      await syncPrice(event.data.object.id, { database });
      return;
    case "price.deleted":
      await database
        .update(billingPrices)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(billingPrices.stripePriceId, event.data.object.id));
      return;
    case "product.created":
    case "product.updated":
      await syncProductPrices(event.data.object.id, { database });
      return;
    default:
      return;
  }
}

/**
 * Stripe webhook (contracts/api.md, «Suscripción»). The signature is checked
 * over the raw body; each event id is recorded once in `billing_event` and
 * the subscription is re-read from Stripe, so duplicates and out-of-order
 * deliveries converge. Payloads and card data are never logged or stored.
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  let event: Stripe.Event;
  try {
    event = await verifyStripeWebhook(
      await request.text(),
      request.headers.get("stripe-signature"),
    );
  } catch (error) {
    if (!(error instanceof InvalidWebhookSignatureError)) {
      logSafe("error", "billing.webhook_config_failed", {
        request_id: requestId,
        error_type: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return Response.json(
      {
        error: {
          code: "validation_error",
          message: "La firma del webhook no es válida.",
        },
      },
      { status: 400 },
    );
  }

  const database = createDatabase();
  const now = new Date();
  const [inserted] = await database
    .insert(billingEvents)
    .values({
      id: createUuidV7(now.getTime()),
      stripeEventId: event.id,
      type: event.type,
      receivedAt: now,
    })
    .onConflictDoNothing({ target: billingEvents.stripeEventId })
    .returning({ id: billingEvents.id });

  let billingEventId = inserted?.id;
  if (!billingEventId) {
    const [existing] = await database
      .select({ id: billingEvents.id, processedAt: billingEvents.processedAt })
      .from(billingEvents)
      .where(eq(billingEvents.stripeEventId, event.id));
    if (!existing || existing.processedAt) {
      return Response.json({ received: true, duplicate: true });
    }
    // A previous delivery failed mid-way: processing is idempotent, retry it.
    billingEventId = existing.id;
  }

  try {
    await dispatch(event, database, billingEventId);
    await database
      .update(billingEvents)
      .set({ processedAt: new Date(), errorCode: null })
      .where(eq(billingEvents.id, billingEventId));
    return Response.json({ received: true });
  } catch (error) {
    await database
      .update(billingEvents)
      .set({ errorCode: "processing_failed" })
      .where(eq(billingEvents.id, billingEventId));
    logSafe("error", "billing.webhook_failed", {
      request_id: requestId,
      event_type: event.type,
      error_type: error instanceof Error ? error.name : "UnknownError",
    });
    // Stripe retries non-2xx responses with backoff.
    return Response.json(
      {
        error: {
          code: "internal_error",
          message: "No se ha podido procesar el evento.",
        },
      },
      { status: 500 },
    );
  }
}

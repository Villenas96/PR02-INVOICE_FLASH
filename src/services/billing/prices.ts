import type Stripe from "stripe";

import { createDatabase, type Database } from "@/db";
import { billingPrices } from "@/db/schema/billing-price";
import { parseLookupKey } from "@/lib/billing-plan";
import { getStripeClient, type StripeClient } from "@/services/billing/stripe";

interface PriceSyncDependencies {
  database?: Database;
  stripe?: StripeClient;
  now?: Date;
}

function productActive(price: Stripe.Price): boolean {
  return typeof price.product === "object" && price.product !== null
    ? !("deleted" in price.product) && price.product.active
    : true;
}

async function upsertPrice(
  database: Database,
  price: Stripe.Price,
  now: Date,
): Promise<boolean> {
  const lookup = parseLookupKey(price.lookup_key ?? "");
  if (!lookup || price.lookup_key === null || price.unit_amount === null) {
    return false;
  }
  const values = {
    lookupKey: price.lookup_key,
    stripePriceId: price.id,
    plan: lookup.plan,
    interval: lookup.interval,
    unitAmountCents: price.unit_amount,
    currency: price.currency,
    active: price.active && productActive(price),
    updatedAt: now,
  };
  await database
    .insert(billingPrices)
    .values(values)
    .onConflictDoUpdate({ target: billingPrices.lookupKey, set: values });
  return true;
}

/**
 * Prices are configured in Stripe and synchronised here so the plans page
 * changes without a deploy (spec, Assumptions). Prices without one of the
 * known lookup keys are ignored.
 */
export async function syncPrice(
  priceId: string,
  dependencies: PriceSyncDependencies = {},
): Promise<boolean> {
  const stripe = dependencies.stripe ?? getStripeClient();
  const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
  return upsertPrice(
    dependencies.database ?? createDatabase(),
    price,
    dependencies.now ?? new Date(),
  );
}

export async function syncProductPrices(
  productId: string,
  dependencies: PriceSyncDependencies = {},
): Promise<number> {
  const stripe = dependencies.stripe ?? getStripeClient();
  const database = dependencies.database ?? createDatabase();
  const now = dependencies.now ?? new Date();
  const prices = await stripe.prices.list({
    product: productId,
    limit: 100,
    expand: ["data.product"],
  });
  let synced = 0;
  for (const price of prices.data) {
    if (await upsertPrice(database, price, now)) {
      synced += 1;
    }
  }
  return synced;
}

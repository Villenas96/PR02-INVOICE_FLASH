import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { planEnum } from "./company";
import { billingIntervalEnum } from "./subscription";

/**
 * Prices synchronised from Stripe (`price.*`/`product.*` webhooks) so the plans
 * page shows current prices without a deploy. Keyed by Stripe `lookup_key`.
 */
export const billingPrices = pgTable(
  "billing_price",
  {
    lookupKey: text("lookup_key").primaryKey(),
    stripePriceId: text("stripe_price_id").notNull(),
    plan: planEnum("plan").notNull(),
    interval: billingIntervalEnum("interval").notNull(),
    unitAmountCents: integer("unit_amount_cents").notNull(),
    currency: text("currency").notNull(),
    active: boolean("active").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("billing_price_stripe_price_unique").on(table.stripePriceId),
  ],
);

import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Stripe webhook events received, for idempotency only. The payload is never
 * stored (data minimisation); rows are kept 90 days.
 */
export const billingEvents = pgTable(
  "billing_event",
  {
    id: uuid("id").primaryKey(),
    stripeEventId: text("stripe_event_id").notNull(),
    type: text("type").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    errorCode: text("error_code"),
  },
  (table) => [
    uniqueIndex("billing_event_stripe_event_unique").on(table.stripeEventId),
  ],
);

import {
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { companies, planEnum } from "./company";

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "past_due",
  "canceled",
  "incomplete",
]);
export const billingIntervalEnum = pgEnum("billing_interval", [
  "month",
  "year",
]);

/**
 * Local copy of the company's Stripe subscription, written only by the
 * reconciliation (re-read from the Stripe API, never from a webhook payload).
 * `plan` is the contracted plan; the effective plan lives in `company.plan`.
 */
export const subscriptions = pgTable(
  "subscription",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id"),
    plan: planEnum("plan").notNull(),
    interval: billingIntervalEnum("interval"),
    status: subscriptionStatusEnum("status").notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    graceUntil: timestamp("grace_until", { withTimezone: true }),
    graceNoticeSentAt: timestamp("grace_notice_sent_at", {
      withTimezone: true,
    }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("subscription_company_unique").on(table.companyId),
    uniqueIndex("subscription_stripe_customer_unique").on(
      table.stripeCustomerId,
    ),
    uniqueIndex("subscription_stripe_subscription_unique").on(
      table.stripeSubscriptionId,
    ),
  ],
);

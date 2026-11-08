import { index, pgEnum, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

import { billingEvents } from "./billing-event";
import { companies, planEnum } from "./company";

export const planChangeReasonEnum = pgEnum("plan_change_reason", [
  "checkout",
  "portal",
  "renewal_failed",
  "grace_expired",
  "canceled",
  "migration",
  "admin",
]);

/** Effective plan history (INSERT only, FR-013). */
export const planChanges = pgTable(
  "plan_change",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    fromPlan: planEnum("from_plan").notNull(),
    toPlan: planEnum("to_plan").notNull(),
    reason: planChangeReasonEnum("reason").notNull(),
    billingEventId: uuid("billing_event_id").references(
      () => billingEvents.id,
      { onDelete: "restrict" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("plan_change_company_created_at_idx").on(
      table.companyId,
      table.createdAt,
    ),
  ],
);

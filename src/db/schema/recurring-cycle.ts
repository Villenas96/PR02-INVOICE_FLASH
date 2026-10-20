import {
  date,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { companies } from "./company";
import { recurringTemplates } from "./recurring-template";

export const recurringOutcomeEnum = pgEnum("recurring_outcome", [
  "pending",
  "draft_created",
  "issued",
  "sent",
  "skipped_plan",
  "failed",
]);

/**
 * One generated cycle of a template. The unique `(template_id,
 * cycle_index)` is the idempotent claim (SC-008): a redelivered or repeated
 * planner run can never generate the same cycle twice.
 */
export const recurringCycles = pgTable(
  "recurring_cycle",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => recurringTemplates.id, { onDelete: "restrict" }),
    cycleIndex: integer("cycle_index").notNull(),
    scheduledOn: date("scheduled_on", { mode: "string" }).notNull(),
    templateVersion: integer("template_version").notNull(),
    outcome: recurringOutcomeEnum("outcome").notNull().default("pending"),
    reasonCode: text("reason_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("recurring_cycle_template_index_unique").on(
      table.templateId,
      table.cycleIndex,
    ),
  ],
);

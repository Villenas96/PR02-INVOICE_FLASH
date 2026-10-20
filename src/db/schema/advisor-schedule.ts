import {
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { companies } from "./company";

export const advisorScheduleFrequencyEnum = pgEnum(
  "advisor_schedule_frequency",
  ["monthly", "quarterly"],
);

/** Scheduled sends to the advisor (FR-034); only applies with Pro. */
export const advisorSchedules = pgTable("advisor_schedule", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "restrict" }),
  frequency: advisorScheduleFrequencyEnum("frequency").notNull(),
  formats: text("formats").array().notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastPeriodKey: text("last_period_key"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

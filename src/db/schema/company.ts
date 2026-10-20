import { sql } from "drizzle-orm";
import {
  check,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";

// Superset during the expand/contract plan migration (data-model, «Migración
// del plan»): v1 code still writes `free`/`pro` until `0005_billing` maps
// them to `basic`/`essential`; `free` is dropped in the Polish contract step.
export const planEnum = pgEnum("plan", ["basic", "essential", "pro"]);
export const uiModeEnum = pgEnum("ui_mode", ["simple", "full"]);

export const companies = pgTable(
  "company",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    legalName: text("legal_name"),
    taxId: text("tax_id"),
    address: text("address"),
    email: text("email").notNull(),
    phone: text("phone"),
    logoKey: text("logo_key"),
    defaultDueDays: integer("default_due_days").notNull().default(30),
    retentionRate: numeric("retention_rate", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    currency: text("currency").notNull().default("EUR"),
    plan: planEnum("plan").notNull().default("basic"),
    /** `null` = plan default (simple for Basic/Essential, full for Pro). */
    uiMode: uiModeEnum("ui_mode"),
    /** Destination of manual and scheduled advisor sends (FR-032, FR-034). */
    advisorEmail: text("advisor_email"),
    /** `{enabled, days_before?, on_due, every_days_after?, max_count}`. */
    reminderPolicy: jsonb("reminder_policy")
      .notNull()
      .default(sql`'{"enabled":false}'::jsonb`),
    /** `{completed: Step[], skipped: Step[], dismissed_at?}` (FR-048). */
    onboarding: jsonb("onboarding").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("company_user_unique").on(table.userId),
    check(
      "company_default_due_days_positive",
      sql`${table.defaultDueDays} > 0`,
    ),
  ],
);

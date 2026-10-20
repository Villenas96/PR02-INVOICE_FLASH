import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { clients } from "./client";
import { collectionMethods } from "./collection-method";
import { companies } from "./company";
import { documentSeries } from "./document-series";

export const recurringFrequencyEnum = pgEnum("recurring_frequency", [
  "weekly",
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
  "custom",
]);
export const recurringIntervalUnitEnum = pgEnum("recurring_interval_unit", [
  "day",
  "week",
  "month",
]);
export const recurringActionEnum = pgEnum("recurring_action", [
  "draft",
  "issue",
  "issue_and_send",
]);
export const recurringStatusEnum = pgEnum("recurring_status", [
  "active",
  "paused",
  "finished",
]);

/** Recurring invoice template (FR-038–040). */
export const recurringTemplates = pgTable(
  "recurring_template",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    seriesId: uuid("series_id").references(() => documentSeries.id, {
      onDelete: "restrict",
    }),
    collectionMethodId: uuid("collection_method_id").references(
      () => collectionMethods.id,
      { onDelete: "set null" },
    ),
    /** Same schema as draft lines; amounts in cents. */
    lines: jsonb("lines").notNull(),
    notes: text("notes"),
    dueDays: integer("due_days").notNull().default(30),
    frequency: recurringFrequencyEnum("frequency").notNull(),
    intervalCount: integer("interval_count").notNull().default(1),
    intervalUnit: recurringIntervalUnitEnum("interval_unit"),
    startOn: date("start_on", { mode: "string" }).notNull(),
    endOn: date("end_on", { mode: "string" }),
    maxCycles: integer("max_cycles"),
    action: recurringActionEnum("action").notNull().default("draft"),
    status: recurringStatusEnum("status").notNull().default("active"),
    /** Recomputed only by `lib/recurrence`; `null` once finished. */
    nextRunOn: date("next_run_on", { mode: "string" }),
    /** Bumped on every edit; cycles record the version they applied. */
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("recurring_template_next_run_on_active_idx")
      .on(table.nextRunOn)
      .where(sql`${table.status} = 'active'`),
    index("recurring_template_company_status_idx").on(
      table.companyId,
      table.status,
    ),
    check(
      "recurring_template_single_end",
      sql`${table.endOn} IS NULL OR ${table.maxCycles} IS NULL`,
    ),
    check(
      "recurring_template_interval_positive",
      sql`${table.intervalCount} >= 1`,
    ),
    check(
      "recurring_template_max_cycles_positive",
      sql`${table.maxCycles} IS NULL OR ${table.maxCycles} >= 1`,
    ),
    check("recurring_template_due_days_valid", sql`${table.dueDays} >= 0`),
  ],
);

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { companies } from "./company";

/** Company tax types (FR-023): name and rate are frozen into each line. */
export const taxRates = pgTable(
  "tax_rate",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    rate: numeric("rate", { precision: 5, scale: 2 }).notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("tax_rate_company_name_rate_unique")
      .on(table.companyId, table.name, table.rate)
      .where(sql`${table.archivedAt} IS NULL`),
    uniqueIndex("tax_rate_company_default_unique")
      .on(table.companyId)
      .where(sql`${table.isDefault} AND ${table.archivedAt} IS NULL`),
    check(
      "tax_rate_rate_valid",
      sql`${table.rate} >= 0 AND ${table.rate} < 100`,
    ),
    check(
      "tax_rate_name_length",
      sql`char_length(${table.name}) BETWEEN 1 AND 30`,
    ),
  ],
);

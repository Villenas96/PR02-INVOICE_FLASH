import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { companies } from "./company";
import { importJobs } from "./import-job";
import { taxRates } from "./tax-rate";

export const catalogItems = pgTable(
  "catalog_item",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    description: text("description").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull(),
    unit: text("unit"),
    taxRateId: uuid("tax_rate_id").references(() => taxRates.id, {
      onDelete: "set null",
    }),
    /** Import that created or last updated it (FR-031). */
    sourceImportId: uuid("source_import_id").references(() => importJobs.id, {
      onDelete: "set null",
    }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    searchText: text("search_text").generatedAlwaysAs(
      sql`immutable_unaccent(lower(description))`,
    ),
  },
  (table) => [
    index("catalog_item_company_archived_idx").on(
      table.companyId,
      table.archivedAt,
    ),
    index("catalog_item_company_description_idx").on(
      table.companyId,
      table.description,
    ),
    index("catalog_item_search_text_trgm_idx").using(
      "gin",
      table.searchText.op("gin_trgm_ops"),
    ),
    check("catalog_item_price_nonnegative", sql`${table.unitPriceCents} >= 0`),
    check(
      "catalog_item_tax_rate_valid",
      sql`${table.taxRate} >= 0 AND ${table.taxRate} < 100`,
    ),
  ],
);

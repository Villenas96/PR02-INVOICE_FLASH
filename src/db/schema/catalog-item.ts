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
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
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
    check("catalog_item_price_nonnegative", sql`${table.unitPriceCents} >= 0`),
    check(
      "catalog_item_tax_rate_valid",
      sql`${table.taxRate} >= 0 AND ${table.taxRate} < 100`,
    ),
  ],
);

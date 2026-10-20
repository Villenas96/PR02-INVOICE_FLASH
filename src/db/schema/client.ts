import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { companies } from "./company";

export const clients = pgTable(
  "client",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    taxId: text("tax_id"),
    address: text("address"),
    email: text("email"),
    phone: text("phone"),
    postalCode: text("postal_code"),
    city: text("city"),
    notes: text("notes"),
    /** Content-addressed R2 key, frozen into the client snapshot at issue. */
    logoKey: text("logo_key"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Accent- and case-insensitive search over every visible field (FR-028).
     * `||` instead of `concat_ws`, which is only STABLE.
     */
    searchText: text("search_text").generatedAlwaysAs(
      sql`immutable_unaccent(lower(coalesce(name, '') || ' ' || coalesce(tax_id, '') || ' ' || coalesce(email, '') || ' ' || coalesce(phone, '') || ' ' || coalesce(address, '') || ' ' || coalesce(postal_code, '') || ' ' || coalesce(city, '')))`,
    ),
  },
  (table) => [
    index("client_company_archived_idx").on(table.companyId, table.archivedAt),
    index("client_company_name_idx").on(table.companyId, table.name),
    index("client_company_tax_id_idx").on(table.companyId, table.taxId),
    index("client_search_text_trgm_idx").using(
      "gin",
      table.searchText.op("gin_trgm_ops"),
    ),
  ],
);

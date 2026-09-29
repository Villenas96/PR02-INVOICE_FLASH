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
    notes: text("notes"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("client_company_archived_idx").on(table.companyId, table.archivedAt),
    index("client_company_name_idx").on(table.companyId, table.name),
    index("client_company_tax_id_idx").on(table.companyId, table.taxId),
  ],
);

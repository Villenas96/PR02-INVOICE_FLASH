import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { companies } from "./company";
import { documents } from "./document";

export const paymentMethodEnum = pgEnum("payment_method", [
  "transfer",
  "cash",
  "card",
  "other",
]);

export const payments = pgTable(
  "payment",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    confirmedOverpayment: boolean("confirmed_overpayment")
      .notNull()
      .default(false),
    paidOn: date("paid_on").notNull(),
    method: paymentMethodEnum("method"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("payment_document_idx").on(table.documentId),
    index("payment_company_paid_on_idx").on(table.companyId, table.paidOn),
    check("payment_amount_positive", sql`${table.amountCents} > 0`),
  ],
);

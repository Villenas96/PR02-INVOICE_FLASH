import { sql } from "drizzle-orm";
import {
  check,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";

export const planEnum = pgEnum("plan", ["free", "pro"]);

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
    defaultTaxRate: numeric("default_tax_rate", { precision: 5, scale: 2 })
      .notNull()
      .default("21.00"),
    retentionRate: numeric("retention_rate", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    currency: text("currency").notNull().default("EUR"),
    plan: planEnum("plan").notNull().default("free"),
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

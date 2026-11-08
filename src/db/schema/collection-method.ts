import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { companies } from "./company";

export const collectionMethodKindEnum = pgEnum("collection_method_kind", [
  "bank_account",
  "bizum",
  "paypal",
  "cash",
  "other",
]);

/**
 * How the company gets paid (FR-021). Named «collection method» to avoid
 * clashing with `payment.method` (how one payment was received). The IBAN
 * is stored normalised and never logged.
 */
export const collectionMethods = pgTable(
  "collection_method",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    kind: collectionMethodKindEnum("kind").notNull(),
    label: text("label").notNull(),
    holderName: text("holder_name"),
    iban: text("iban"),
    bic: text("bic"),
    phone: text("phone"),
    emailOrUrl: text("email_or_url"),
    instructions: text("instructions"),
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
    index("collection_method_company_archived_idx").on(
      table.companyId,
      table.archivedAt,
    ),
    uniqueIndex("collection_method_company_default_unique")
      .on(table.companyId)
      .where(sql`${table.isDefault} AND ${table.archivedAt} IS NULL`),
  ],
);

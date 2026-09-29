import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { companies } from "./company";

export const documentTypeEnum = pgEnum("document_type", [
  "invoice",
  "proforma",
  "receipt",
]);

export const documentSeries = pgTable(
  "document_series",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    documentType: documentTypeEnum("document_type").notNull(),
    prefix: text("prefix").notNull(),
    nextNumber: integer("next_number").notNull().default(1),
    isDefault: boolean("is_default").notNull().default(false),
  },
  (table) => [
    uniqueIndex("document_series_company_type_prefix_unique").on(
      table.companyId,
      table.documentType,
      table.prefix,
    ),
    uniqueIndex("document_series_company_type_default_unique")
      .on(table.companyId, table.documentType)
      .where(sql`${table.isDefault}`),
    check(
      "document_series_next_number_positive",
      sql`${table.nextNumber} >= 1`,
    ),
  ],
);

import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { bankStatements } from "./bank-statement";
import { collectionMethods } from "./collection-method";
import { companies } from "./company";

/**
 * Bank movement (FR-043). The unique `(collection_method_id, fingerprint,
 * occurrence)` makes re-importing the same or an overlapping statement a
 * no-op, while two identical genuine movements keep distinct `occurrence`s.
 */
export const bankTransactions = pgTable(
  "bank_transaction",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    collectionMethodId: uuid("collection_method_id")
      .notNull()
      .references(() => collectionMethods.id, { onDelete: "restrict" }),
    statementId: uuid("statement_id")
      .notNull()
      .references(() => bankStatements.id, { onDelete: "restrict" }),
    operationOn: date("operation_on", { mode: "string" }).notNull(),
    valueOn: date("value_on", { mode: "string" }),
    /** Positive = income; negative = charge (never proposed for matching). */
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    /** Concept + complementary records. Excluded from logs. */
    concept: text("concept").notNull().default(""),
    reference: text("reference"),
    fingerprint: text("fingerprint").notNull(),
    occurrence: integer("occurrence").notNull().default(1),
    ignoredAt: timestamp("ignored_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("bank_transaction_fingerprint_unique").on(
      table.collectionMethodId,
      table.fingerprint,
      table.occurrence,
    ),
    index("bank_transaction_company_operation_idx").on(
      table.companyId,
      table.operationOn,
    ),
    index("bank_transaction_statement_idx").on(table.statementId),
    index("bank_transaction_income_idx")
      .on(table.companyId, table.operationOn)
      .where(sql`${table.amountCents} > 0`),
  ],
);

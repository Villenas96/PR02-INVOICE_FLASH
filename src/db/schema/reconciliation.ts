import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { bankTransactions } from "./bank-transaction";
import { companies } from "./company";
import { documents } from "./document";
import { payments } from "./payment";

/**
 * Allocation of (part of) a bank movement to an invoice (FR-045). Each row
 * owns the `payment` it created; undoing deletes both. The sum per
 * movement never exceeds the movement (checked under a row lock).
 */
export const reconciliations = pgTable(
  "reconciliation",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    bankTransactionId: uuid("bank_transaction_id")
      .notNull()
      .references(() => bankTransactions.id, { onDelete: "restrict" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "restrict" }),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("reconciliation_payment_unique").on(table.paymentId),
    index("reconciliation_document_idx").on(table.documentId),
    index("reconciliation_transaction_idx").on(table.bankTransactionId),
    check("reconciliation_amount_positive", sql`${table.amountCents} > 0`),
  ],
);

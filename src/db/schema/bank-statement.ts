import {
  bigint,
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { collectionMethods } from "./collection-method";
import { companies } from "./company";
import { importJobs } from "./import-job";

export const bankStatementFormatEnum = pgEnum("bank_statement_format", [
  "norma43",
  "csv",
  "xlsx",
]);

export const bankStatements = pgTable(
  "bank_statement",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    collectionMethodId: uuid("collection_method_id")
      .notNull()
      .references(() => collectionMethods.id, { onDelete: "restrict" }),
    format: bankStatementFormatEnum("format").notNull(),
    fileKey: text("file_key").notNull(),
    periodStart: date("period_start", { mode: "string" }),
    periodEnd: date("period_end", { mode: "string" }),
    closingBalanceCents: bigint("closing_balance_cents", { mode: "number" }),
    closingBalanceOn: date("closing_balance_on", { mode: "string" }),
    importJobId: uuid("import_job_id").references(() => importJobs.id, {
      onDelete: "set null",
    }),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("bank_statement_company_imported_idx").on(
      table.companyId,
      table.importedAt,
    ),
    index("bank_statement_method_closing_idx").on(
      table.collectionMethodId,
      table.closingBalanceOn,
    ),
  ],
);

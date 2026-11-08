import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { companies } from "./company";

export const importKindEnum = pgEnum("import_kind", [
  "catalog",
  "bank_statement",
]);
export const importStatusEnum = pgEnum("import_status", [
  "uploaded",
  "analyzing",
  "preview_ready",
  "applying",
  "done",
  "failed",
  "rejected",
]);
export const importDuplicatePolicyEnum = pgEnum("import_duplicate_policy", [
  "skip",
  "update",
]);

/** CSV/statement import (FR-031, FR-043): at most 5 MB and 5.000 rows. */
export const importJobs = pgTable(
  "import_job",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    kind: importKindEnum("kind").notNull(),
    fileKey: text("file_key").notNull(),
    status: importStatusEnum("status").notNull().default("uploaded"),
    mapping: jsonb("mapping"),
    duplicatePolicy: importDuplicatePolicyEnum("duplicate_policy"),
    /** Summary, ≤ 50 sample rows and ≤ 500 row errors. */
    preview: jsonb("preview"),
    /** `{created, updated, skipped, errored}`. */
    result: jsonb("result"),
    rowCount: integer("row_count"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("import_job_company_created_at_idx").on(
      table.companyId,
      table.createdAt,
    ),
  ],
);

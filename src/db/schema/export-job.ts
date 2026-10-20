import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { companies } from "./company";

export const exportKindEnum = pgEnum("export_kind", [
  "period_excel",
  "advanced",
]);
export const exportStatusEnum = pgEnum("export_status", [
  "queued",
  "running",
  "ready",
  "empty",
  "failed",
]);

/** Period and advanced exports (FR-032–034); files expire after 7 days. */
export const exportJobs = pgTable(
  "export_job",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    /** `user:{id}`, `advisor:{id}` or `system` (scheduled sends). */
    requestedBy: text("requested_by").notNull(),
    kind: exportKindEnum("kind").notNull(),
    /** `{types, from, to, status?, client_id?}`. */
    filters: jsonb("filters").notNull(),
    formats: text("formats").array().notNull(),
    periodKey: text("period_key"),
    status: exportStatusEnum("status").notNull().default("queued"),
    fileKeys: jsonb("file_keys").notNull().default(sql`'[]'::jsonb`),
    downloadTokenHash: text("download_token_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    sendToAdvisor: boolean("send_to_advisor").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("export_job_download_token_hash_unique").on(
      table.downloadTokenHash,
    ),
    // Scheduled sends are idempotent per company and period.
    uniqueIndex("export_job_system_period_unique")
      .on(table.companyId, table.periodKey)
      .where(sql`${table.requestedBy} = 'system'`),
    index("export_job_company_created_at_idx").on(
      table.companyId,
      table.createdAt,
    ),
    index("export_job_expires_at_idx").on(table.expiresAt),
  ],
);

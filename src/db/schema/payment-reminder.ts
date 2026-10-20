import {
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { companies } from "./company";
import { documents } from "./document";
import { emailDeliveries } from "./email-delivery";

export const reminderOutcomeEnum = pgEnum("reminder_outcome", [
  "queued",
  "sent",
  "skipped_paid",
  "skipped_no_email",
  "failed",
]);

/**
 * One reminder per invoice and day (FR-041, FR-042): the unique
 * `(document_id, scheduled_on)` row is the idempotent claim, and
 * `(document_id, sequence)` caps how many are ever sent.
 */
export const paymentReminders = pgTable(
  "payment_reminder",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "restrict" }),
    scheduledOn: date("scheduled_on", { mode: "string" }).notNull(),
    sequence: integer("sequence").notNull(),
    outcome: reminderOutcomeEnum("outcome").notNull().default("queued"),
    emailDeliveryId: uuid("email_delivery_id").references(
      () => emailDeliveries.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("payment_reminder_document_day_unique").on(
      table.documentId,
      table.scheduledOn,
    ),
    uniqueIndex("payment_reminder_document_sequence_unique").on(
      table.documentId,
      table.sequence,
    ),
    index("payment_reminder_company_created_idx").on(
      table.companyId,
      table.createdAt,
    ),
  ],
);

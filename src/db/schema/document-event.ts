import { sql } from "drizzle-orm";
import {
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
import { documents } from "./document";

export const documentEventTypeEnum = pgEnum("document_event_type", [
  "created",
  "updated",
  "issued",
  "voided",
  "converted",
  "duplicated",
  "pdf_generated",
  "pdf_failed",
  "link_created",
  "link_disabled",
  "email_queued",
  "email_sent",
  "email_failed",
  "payment_added",
  "payment_updated",
  "payment_deleted",
]);

export const documentEvents = pgTable(
  "document_event",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "restrict" }),
    actor: text("actor").notNull(),
    event: documentEventTypeEnum("event").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("document_event_document_created_at_idx").on(
      table.documentId,
      table.createdAt,
    ),
    uniqueIndex("document_event_document_pdf_terminal_unique")
      .on(table.documentId, table.event)
      .where(
        sql`${table.event} IN ('pdf_generated'::document_event_type, 'pdf_failed'::document_event_type)`,
      ),
  ],
);

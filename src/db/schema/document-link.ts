import { sql } from "drizzle-orm";
import {
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { companies } from "./company";
import { documents } from "./document";

export const documentLinkKindEnum = pgEnum("document_link_kind", [
  "converted",
  "invoiced",
]);

/**
 * Links between documents (FR-036, FR-037): conversions (proforma/quote →
 * invoice, quote → delivery note…) and delivery notes billed by an invoice.
 * Voiding the target releases the link instead of deleting it.
 */
export const documentLinks = pgTable(
  "document_link",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    sourceDocumentId: uuid("source_document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "restrict" }),
    targetDocumentId: uuid("target_document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "restrict" }),
    kind: documentLinkKindEnum("kind").notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // A delivery note is billed by at most one live invoice.
    uniqueIndex("document_link_invoiced_source_unique")
      .on(table.sourceDocumentId)
      .where(sql`${table.kind} = 'invoiced' AND ${table.releasedAt} IS NULL`),
    index("document_link_target_idx").on(table.targetDocumentId),
    index("document_link_source_kind_idx").on(
      table.sourceDocumentId,
      table.kind,
    ),
  ],
);

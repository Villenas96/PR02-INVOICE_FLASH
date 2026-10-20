import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { catalogItems } from "./catalog-item";
import { clients } from "./client";
import { collectionMethods } from "./collection-method";
import { companies } from "./company";
import { documentSeries, documentTypeEnum } from "./document-series";
import { recurringCycles } from "./recurring-cycle";
import { taxRates } from "./tax-rate";

export const documentStatusEnum = pgEnum("document_status", [
  "draft",
  "issued",
  "voided",
]);
export const pdfStatusEnum = pgEnum("pdf_status", [
  "pending",
  "ready",
  "failed",
]);

export const quoteDecisionEnum = pgEnum("quote_decision", [
  "accepted",
  "rejected",
]);

export const documents = pgTable(
  "document",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    documentType: documentTypeEnum("document_type").notNull(),
    status: documentStatusEnum("status").notNull().default("draft"),
    seriesId: uuid("series_id").references(() => documentSeries.id, {
      onDelete: "restrict",
    }),
    number: integer("number"),
    fullNumber: text("full_number"),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "restrict",
    }),
    issueDate: date("issue_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }),
    notes: text("notes"),
    /** Draft reference; preselected with the default method (FR-022). */
    collectionMethodId: uuid("collection_method_id").references(
      () => collectionMethods.id,
      { onDelete: "restrict" },
    ),
    /** Frozen at issue: `{kind, label, holder?, iban?, bic?, phone?,
     * email_or_url?, instructions?}`. */
    collectionMethodSnapshot: jsonb("collection_method_snapshot"),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    taxBreakdown: jsonb("tax_breakdown").notNull().default(sql`'[]'::jsonb`),
    retentionRate: numeric("retention_rate", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    retentionCents: integer("retention_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    issuerSnapshot: jsonb("issuer_snapshot"),
    clientSnapshot: jsonb("client_snapshot"),
    /** Quotes only (FR-035): `>= issue_date`. */
    validUntil: date("valid_until", { mode: "string" }),
    /** Operational, not fiscal: the derived quote state reads it. */
    quoteDecision: quoteDecisionEnum("quote_decision"),
    /** Per-invoice opt-out of payment reminders (FR-041). */
    remindersEnabled: boolean("reminders_enabled").notNull().default(true),
    quoteDecidedAt: timestamp("quote_decided_at", { withTimezone: true }),
    /** Cycle that generated this document (one document per cycle). */
    recurringCycleId: uuid("recurring_cycle_id").references(
      () => recurringCycles.id,
      { onDelete: "restrict" },
    ),
    invoiceId: uuid("invoice_id"),
    paymentId: uuid("payment_id"),
    pdfStatus: pdfStatusEnum("pdf_status"),
    pdfReadyAt: timestamp("pdf_ready_at", { withTimezone: true }),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("document_company_type_status_issue_date_idx").on(
      table.companyId,
      table.documentType,
      table.status,
      table.issueDate,
    ),
    index("document_company_client_idx").on(table.companyId, table.clientId),
    // Not partial on `document_type = 'quote'`: that value is added with
    // `ADD VALUE` in the same migration run, where it cannot be used yet.
    index("document_company_type_quote_decision_idx").on(
      table.companyId,
      table.documentType,
      table.quoteDecision,
    ),
    index("document_company_client_type_status_idx").on(
      table.companyId,
      table.clientId,
      table.documentType,
      table.status,
    ),
    index("document_company_issued_at_idx").on(table.companyId, table.issuedAt),
    // Orphan-logo purge: a logo key still frozen in any snapshot is kept.
    index("document_issuer_logo_key_idx").on(
      sql`(${table.issuerSnapshot} ->> 'logoKey')`,
    ),
    index("document_client_logo_key_idx").on(
      sql`(${table.clientSnapshot} ->> 'logoKey')`,
    ),
    index("document_company_deleted_at_idx").on(
      table.companyId,
      table.deletedAt,
    ),
    index("document_company_due_date_issued_invoice_idx")
      .on(table.companyId, table.dueDate)
      .where(
        sql`${table.status} = 'issued' AND ${table.documentType} = 'invoice'`,
      ),
    uniqueIndex("document_company_full_number_issued_unique")
      .on(table.companyId, table.fullNumber)
      .where(sql`${table.status} IN ('issued', 'voided')`),
    uniqueIndex("document_recurring_cycle_unique").on(table.recurringCycleId),
    uniqueIndex("document_payment_receipt_unique")
      .on(table.paymentId)
      .where(sql`${table.documentType} = 'receipt'`),
    check(
      "document_issued_has_number",
      sql`${table.status} = 'draft' OR ${table.number} IS NOT NULL`,
    ),
  ],
);

export const documentLines = pgTable(
  "document_line",
  {
    id: uuid("id").primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull(),
    discountPercentage: numeric("discount_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    /** Unit text, frozen like the description (FR-030). */
    unit: text("unit"),
    /** Draft-only reference; the name and rate below are what is frozen. */
    taxRateId: uuid("tax_rate_id").references(() => taxRates.id, {
      onDelete: "set null",
    }),
    taxName: text("tax_name").notNull().default("IVA"),
    catalogItemId: uuid("catalog_item_id").references(() => catalogItems.id, {
      onDelete: "set null",
    }),
    /** Groups lines by delivery note when invoicing several (US9-AC4). */
    sectionLabel: text("section_label"),
    lineSubtotalCents: integer("line_subtotal_cents").notNull().default(0),
    lineTaxCents: integer("line_tax_cents").notNull().default(0),
    lineTotalCents: integer("line_total_cents").notNull().default(0),
  },
  (table) => [
    uniqueIndex("document_line_document_position_unique").on(
      table.documentId,
      table.position,
    ),
    check("document_line_quantity_positive", sql`${table.quantity} > 0`),
    check("document_line_price_nonnegative", sql`${table.unitPriceCents} >= 0`),
    check(
      "document_line_tax_rate_valid",
      sql`${table.taxRate} >= 0 AND ${table.taxRate} < 100`,
    ),
    check(
      "document_line_discount_percentage_valid",
      sql`${table.discountPercentage} >= 0 AND ${table.discountPercentage} <= 100`,
    ),
  ],
);

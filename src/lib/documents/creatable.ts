import type { DocumentType } from "@/lib/plan";

/**
 * Types the editor can create as drafts (receipts come from a payment).
 * Quotes and delivery notes join this list with US9.
 */
export const CREATABLE_DOCUMENT_TYPES: readonly DocumentType[] = [
  "invoice",
  "proforma",
];

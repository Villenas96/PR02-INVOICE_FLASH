import type { DocumentType } from "@/lib/plan";

/** Types the editor can create as drafts (receipts come from a payment). */
export const CREATABLE_DOCUMENT_TYPES: readonly DocumentType[] = [
  "invoice",
  "proforma",
  "quote",
  "delivery_note",
];

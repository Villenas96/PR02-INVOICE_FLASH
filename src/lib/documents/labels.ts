import type { DocumentType } from "@/lib/plan";

/** Spanish names of each document type, shared by API messages and UI. */
export const DOCUMENT_TYPE_LABELS: Record<
  DocumentType,
  { singular: string; plural: string }
> = {
  invoice: { singular: "Factura", plural: "facturas" },
  proforma: { singular: "Proforma", plural: "proformas" },
  receipt: { singular: "Recibo", plural: "recibos" },
  quote: { singular: "Presupuesto", plural: "presupuestos" },
  delivery_note: { singular: "Albarán", plural: "albaranes" },
};

export function documentTypeLabel(documentType: DocumentType): string {
  return DOCUMENT_TYPE_LABELS[documentType].singular;
}

export function documentTypePlural(documentType: DocumentType): string {
  return DOCUMENT_TYPE_LABELS[documentType].plural;
}

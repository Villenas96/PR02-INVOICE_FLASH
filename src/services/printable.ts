import type { PrintableDocumentData } from "@/components/documents/printable-document";
import type { DocumentDetail } from "@/services/documents";

interface IssuerSnapshot {
  legalName?: string;
  taxId?: string;
  address?: string;
  email?: string;
  logoKey?: string | null;
}

interface ClientSnapshot {
  name?: string;
  taxId?: string | null;
  address?: string | null;
  logoKey?: string | null;
}

/**
 * Maps a stored document to the printable view: the frozen snapshots and
 * totals only, never live company or client data.
 */
export function printableFromDocument(
  document: DocumentDetail,
  logoUrl?: (key: string) => string,
): PrintableDocumentData {
  const issuer = document.issuerSnapshot as IssuerSnapshot | null;
  const client = document.clientSnapshot as ClientSnapshot | null;
  return {
    documentType: document.documentType,
    fullNumber: document.fullNumber,
    status: document.status,
    issueDate: document.issueDate,
    dueDate: document.dueDate,
    issuer: issuer?.legalName
      ? {
          name: issuer.legalName,
          taxId: issuer.taxId ?? null,
          address: issuer.address ?? null,
          email: issuer.email ?? null,
          logoUrl: issuer.logoKey && logoUrl ? logoUrl(issuer.logoKey) : null,
        }
      : null,
    client: client?.name
      ? {
          name: client.name,
          taxId: client.taxId ?? null,
          address: client.address ?? null,
          logoUrl: client.logoKey && logoUrl ? logoUrl(client.logoKey) : null,
        }
      : null,
    lines: document.lines.map((line) => ({
      id: line.id,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitPriceCents: line.unitPriceCents,
      taxName: line.taxName,
      taxRate: line.taxRate,
      lineTotalCents: line.lineTotalCents,
    })),
    subtotalCents: document.subtotalCents,
    taxBreakdown:
      document.taxBreakdown as PrintableDocumentData["taxBreakdown"],
    retentionRate: document.retentionRate,
    retentionCents: document.retentionCents,
    totalCents: document.totalCents,
    notes: document.notes,
    payment:
      (document.collectionMethodSnapshot as PrintableDocumentData["payment"]) ??
      null,
  };
}

import { DOCUMENT_TYPE_LABELS } from "@/lib/documents/labels";
import type { DocumentType } from "@/lib/plan";

/**
 * Spreadsheet rows for one issued document (FR-027, research R12). Every
 * amount comes from the stored totals — nothing is recalculated — and cents
 * become euros only here, at presentation, so the sheet matches the PDF to
 * the cent.
 */

export interface DocumentSheetInput {
  documentType: DocumentType;
  fullNumber: string;
  issueDate: string;
  dueDate: string | null;
  issuer: { name: string; taxId: string | null; address: string | null };
  client: { name: string; taxId: string | null; address: string | null };
  lines: Array<{
    description: string;
    quantity: string;
    unit: string | null;
    unitPriceCents: number;
    taxName: string;
    taxRate: string;
    lineSubtotalCents: number;
    lineTaxCents: number;
    lineTotalCents: number;
  }>;
  taxBreakdown: Array<{
    name?: string;
    rate: string;
    baseCents: number;
    taxCents: number;
  }>;
  subtotalCents: number;
  retentionRate: string;
  retentionCents: number;
  totalCents: number;
}

export type SheetValue = string | number | null;

export interface DocumentSheet {
  rows: SheetValue[][];
  /** [row, column] of every money cell, formatted `#,##0.00 €`. */
  moneyCells: Array<[number, number]>;
}

export const LINE_HEADERS = [
  "Concepto",
  "Cantidad",
  "Unidad",
  "Precio unitario",
  "Impuesto",
  "Tipo (%)",
  "Base",
  "Cuota",
  "Total",
] as const;

function euros(cents: number): number {
  return cents / 100;
}

function isoToSpanishDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export function buildDocumentSheet(input: DocumentSheetInput): DocumentSheet {
  const rows: SheetValue[][] = [];
  const moneyCells: Array<[number, number]> = [];
  const push = (row: SheetValue[], moneyColumns: number[] = []) => {
    for (const column of moneyColumns) {
      moneyCells.push([rows.length, column]);
    }
    rows.push(row);
  };

  push([DOCUMENT_TYPE_LABELS[input.documentType].singular, input.fullNumber]);
  push(["Fecha de emisión", isoToSpanishDate(input.issueDate)]);
  push([
    "Fecha de vencimiento",
    input.dueDate ? isoToSpanishDate(input.dueDate) : null,
  ]);
  push([]);
  push(["Emisor", input.issuer.name, input.issuer.taxId, input.issuer.address]);
  push([
    "Cliente",
    input.client.name,
    input.client.taxId,
    input.client.address,
  ]);
  push([]);
  push([...LINE_HEADERS]);
  for (const line of input.lines) {
    push(
      [
        line.description,
        Number(line.quantity),
        line.unit,
        euros(line.unitPriceCents),
        line.taxName,
        Number(line.taxRate),
        euros(line.lineSubtotalCents),
        euros(line.lineTaxCents),
        euros(line.lineTotalCents),
      ],
      [3, 6, 7, 8],
    );
  }
  push([]);
  push(["Base imponible", euros(input.subtotalCents)], [1]);
  for (const tax of input.taxBreakdown) {
    push(
      [
        `${tax.name ?? "IVA"} ${Number(tax.rate).toLocaleString("es-ES")} %`,
        euros(tax.taxCents),
        "Base",
        euros(tax.baseCents),
      ],
      [1, 3],
    );
  }
  if (input.retentionCents > 0) {
    push(
      [
        `Retención IRPF (${Number(input.retentionRate).toLocaleString("es-ES")} %)`,
        -euros(input.retentionCents),
      ],
      [1],
    );
  }
  push(["Total", euros(input.totalCents)], [1]);

  return { rows, moneyCells };
}

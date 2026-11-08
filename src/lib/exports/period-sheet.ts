import { DOCUMENT_TYPE_LABELS } from "@/lib/documents/labels";
import type { SheetValue } from "@/lib/exports/document-sheet";
import type { PaymentStatus } from "@/lib/payments";
import type { DocumentType } from "@/lib/plan";

/**
 * Period spreadsheet for the advisor (FR-032): one row per issued or voided
 * document with its fiscal breakdown per tax type, all taken from stored
 * totals (never recalculated; cents → euros only here). Voided documents
 * are listed for traceability but excluded from the totals row.
 */

export interface PeriodSheetDocument {
  documentType: DocumentType;
  fullNumber: string;
  issueDate: string;
  status: "issued" | "voided";
  clientName: string;
  clientTaxId: string | null;
  subtotalCents: number;
  taxBreakdown: Array<{
    name?: string;
    rate: string;
    baseCents: number;
    taxCents: number;
  }>;
  retentionCents: number;
  totalCents: number;
  paymentStatus: PaymentStatus | null;
}

export interface PeriodSheet {
  rows: SheetValue[][];
  moneyCells: Array<[number, number]>;
  totals: {
    subtotalCents: number;
    retentionCents: number;
    totalCents: number;
    taxes: Array<{ label: string; baseCents: number; taxCents: number }>;
  };
}

const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  pending: "Pendiente",
  partial: "Parcial",
  paid: "Pagada",
  overdue: "Vencida",
};

function taxLabel(name: string | undefined, rate: string): string {
  return `${name ?? "IVA"} ${Number(rate).toLocaleString("es-ES")} %`;
}

function euros(cents: number): number {
  return cents / 100;
}

function spanishDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export function buildPeriodSheet(
  documents: readonly PeriodSheetDocument[],
): PeriodSheet {
  const taxKeys = new Map<string, { name?: string; rate: string }>();
  for (const document of documents) {
    for (const tax of document.taxBreakdown) {
      taxKeys.set(taxLabel(tax.name, tax.rate), tax);
    }
  }
  const taxes = [...taxKeys.entries()]
    .sort(([, left], [, right]) =>
      (left.name ?? "IVA") === (right.name ?? "IVA")
        ? Number(right.rate) - Number(left.rate)
        : (left.name ?? "IVA").localeCompare(right.name ?? "IVA", "es"),
    )
    .map(([label]) => label);

  const header: SheetValue[] = [
    "Tipo",
    "Número",
    "Fecha",
    "Estado",
    "Cliente",
    "NIF cliente",
    "Base imponible",
    ...taxes.flatMap((label) => [`Base ${label}`, `Cuota ${label}`]),
    "Retención",
    "Total",
    "Cobro",
  ];
  const moneyColumns = [
    6,
    ...taxes.flatMap((_, index) => [7 + index * 2, 8 + index * 2]),
    7 + taxes.length * 2,
    8 + taxes.length * 2,
  ];
  const rows: SheetValue[][] = [header];
  const totals = {
    subtotalCents: 0,
    retentionCents: 0,
    totalCents: 0,
    taxes: taxes.map((label) => ({ label, baseCents: 0, taxCents: 0 })),
  };

  for (const document of documents) {
    const byLabel = new Map(
      document.taxBreakdown.map((tax) => [taxLabel(tax.name, tax.rate), tax]),
    );
    rows.push([
      DOCUMENT_TYPE_LABELS[document.documentType].singular,
      document.fullNumber,
      spanishDate(document.issueDate),
      document.status === "voided" ? "Anulado" : "Emitido",
      document.clientName,
      document.clientTaxId,
      euros(document.subtotalCents),
      ...taxes.flatMap((label) => {
        const tax = byLabel.get(label);
        return tax ? [euros(tax.baseCents), euros(tax.taxCents)] : [null, null];
      }),
      document.retentionCents > 0 ? -euros(document.retentionCents) : 0,
      euros(document.totalCents),
      document.paymentStatus ? PAYMENT_LABELS[document.paymentStatus] : null,
    ]);
    if (document.status === "voided") {
      continue;
    }
    totals.subtotalCents += document.subtotalCents;
    totals.retentionCents += document.retentionCents;
    totals.totalCents += document.totalCents;
    taxes.forEach((label, index) => {
      const tax = byLabel.get(label);
      const total = totals.taxes[index];
      if (tax && total) {
        total.baseCents += tax.baseCents;
        total.taxCents += tax.taxCents;
      }
    });
  }

  rows.push([
    "Total (sin anulados)",
    null,
    null,
    null,
    null,
    null,
    euros(totals.subtotalCents),
    ...totals.taxes.flatMap((tax) => [
      euros(tax.baseCents),
      euros(tax.taxCents),
    ]),
    totals.retentionCents > 0 ? -euros(totals.retentionCents) : 0,
    euros(totals.totalCents),
    null,
  ]);

  const moneyCells: Array<[number, number]> = [];
  for (let row = 1; row < rows.length; row += 1) {
    for (const column of moneyColumns) {
      moneyCells.push([row, column]);
    }
  }
  return { rows, moneyCells, totals };
}

import { describe, expect, it } from "vitest";

import {
  buildDocumentSheet,
  type DocumentSheetInput,
  LINE_HEADERS,
} from "@/lib/exports/document-sheet";

function input(): DocumentSheetInput {
  return {
    documentType: "invoice",
    fullNumber: "2026-0007",
    issueDate: "2026-07-30",
    dueDate: "2026-08-29",
    issuer: {
      name: "Estudio Norte, S.L.",
      taxId: "B12345678",
      address: "Madrid",
    },
    client: { name: "Cliente, S.A.", taxId: "A87654321", address: "Valencia" },
    lines: [
      {
        description: "Diseño",
        quantity: "2.000",
        unit: "hora",
        unitPriceCents: 4_500,
        taxName: "IGIC",
        taxRate: "7.00",
        lineSubtotalCents: 9_000,
        lineTaxCents: 630,
        lineTotalCents: 9_630,
      },
      {
        description: "Licencia",
        quantity: "1.000",
        unit: null,
        unitPriceCents: 1_111,
        taxName: "IGI",
        taxRate: "4.50",
        lineSubtotalCents: 1_111,
        lineTaxCents: 50,
        lineTotalCents: 1_161,
      },
    ],
    taxBreakdown: [
      { name: "IGI", rate: "4.50", baseCents: 1_111, taxCents: 50 },
      { name: "IGIC", rate: "7.00", baseCents: 9_000, taxCents: 630 },
    ],
    subtotalCents: 10_111,
    retentionRate: "15.00",
    retentionCents: 1_517,
    // Stored total, deliberately not recomputed by the sheet.
    totalCents: 9_274,
  };
}

describe("per-document spreadsheet rows", () => {
  it("lists document, dates, issuer and client", () => {
    const { rows } = buildDocumentSheet(input());
    expect(rows.slice(0, 6)).toEqual([
      ["Factura", "2026-0007"],
      ["Fecha de emisión", "30/07/2026"],
      ["Fecha de vencimiento", "29/08/2026"],
      [],
      ["Emisor", "Estudio Norte, S.L.", "B12345678", "Madrid"],
      ["Cliente", "Cliente, S.A.", "A87654321", "Valencia"],
    ]);
  });

  it("adds one row per line with unit and tax name in euros", () => {
    const { rows } = buildDocumentSheet(input());
    const header = rows.findIndex((row) => row[0] === "Concepto");
    expect(rows[header]).toEqual([...LINE_HEADERS]);
    expect(rows[header + 1]).toEqual([
      "Diseño",
      2,
      "hora",
      45,
      "IGIC",
      7,
      90,
      6.3,
      96.3,
    ]);
    expect(rows[header + 2]?.[2]).toBeNull();
  });

  it("breaks taxes down by name and takes retention and total from stored values", () => {
    const { rows, moneyCells } = buildDocumentSheet(input());
    expect(rows).toContainEqual(["Base imponible", 101.11]);
    expect(rows).toContainEqual(["IGI 4,5 %", 0.5, "Base", 11.11]);
    expect(rows).toContainEqual(["IGIC 7 %", 6.3, "Base", 90]);
    expect(rows).toContainEqual(["Retención IRPF (15 %)", -15.17]);
    expect(rows.at(-1)).toEqual(["Total", 92.74]);
    const totalRow = rows.length - 1;
    expect(moneyCells).toContainEqual([totalRow, 1]);
  });
});

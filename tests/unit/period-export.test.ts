import { describe, expect, it } from "vitest";

import { closedPeriodOn, resolvePeriod } from "@/lib/exports/period";
import {
  buildPeriodSheet,
  type PeriodSheetDocument,
} from "@/lib/exports/period-sheet";

// 2026-10-20 10:00 Madrid.
const NOW = new Date("2026-10-20T08:00:00.000Z");

describe("export periods (Europe/Madrid)", () => {
  it.each([
    ["current_month", "2026-10-01", "2026-10-31", "2026-10"],
    ["previous_month", "2026-09-01", "2026-09-30", "2026-09"],
    ["current_quarter", "2026-10-01", "2026-12-31", "2026-Q4"],
    ["previous_quarter", "2026-07-01", "2026-09-30", "2026-Q3"],
    ["year", "2026-01-01", "2026-12-31", "2026"],
  ] as const)("%s", (period, from, to, key) => {
    expect(resolvePeriod(period, NOW)).toMatchObject({ from, to, key });
  });

  it("crosses year boundaries", () => {
    const january = new Date("2027-01-15T10:00:00.000Z");
    expect(resolvePeriod("previous_month", january).key).toBe("2026-12");
    expect(resolvePeriod("previous_quarter", january)).toMatchObject({
      from: "2026-10-01",
      to: "2026-12-31",
      key: "2026-Q4",
    });
  });

  it("handles February in leap years", () => {
    const march = new Date("2028-03-10T10:00:00.000Z");
    expect(resolvePeriod("previous_month", march).to).toBe("2028-02-29");
  });

  it("uses the Madrid day, not UTC", () => {
    // 2026-10-31 23:30 UTC is already 1 November in Madrid.
    const lateUtc = new Date("2026-10-31T23:30:00.000Z");
    expect(resolvePeriod("current_month", lateUtc).key).toBe("2026-11");
    expect(resolvePeriod("previous_month", lateUtc).key).toBe("2026-10");
  });

  it("labels periods in Spanish", () => {
    expect(resolvePeriod("previous_quarter", NOW).label).toBe(
      "Tercer trimestre de 2026",
    );
    expect(resolvePeriod("previous_month", NOW).label).toBe(
      "septiembre de 2026",
    );
  });

  it("detects the first day after a closed month or quarter", () => {
    const firstOfOctober = new Date("2026-10-01T05:00:00.000Z");
    expect(closedPeriodOn("monthly", firstOfOctober)?.key).toBe("2026-09");
    expect(closedPeriodOn("quarterly", firstOfOctober)?.key).toBe("2026-Q3");
    const firstOfNovember = new Date("2026-11-01T05:00:00.000Z");
    expect(closedPeriodOn("monthly", firstOfNovember)?.key).toBe("2026-10");
    expect(closedPeriodOn("quarterly", firstOfNovember)).toBeNull();
    expect(closedPeriodOn("monthly", NOW)).toBeNull();
  });
});

function document(
  overrides: Partial<PeriodSheetDocument>,
): PeriodSheetDocument {
  return {
    documentType: "invoice",
    fullNumber: "2026-0001",
    issueDate: "2026-09-05",
    status: "issued",
    clientName: "Cliente, S.L.",
    clientTaxId: "B12345678",
    subtotalCents: 10_000,
    taxBreakdown: [
      { name: "IVA", rate: "21.00", baseCents: 10_000, taxCents: 2_100 },
    ],
    retentionCents: 0,
    totalCents: 12_100,
    paymentStatus: "pending",
    ...overrides,
  };
}

describe("period spreadsheet", () => {
  const documents = [
    document({}),
    document({
      fullNumber: "2026-0002",
      subtotalCents: 30_000,
      taxBreakdown: [
        { name: "IVA", rate: "21.00", baseCents: 20_000, taxCents: 4_200 },
        { name: "IVA", rate: "10.00", baseCents: 10_000, taxCents: 1_000 },
      ],
      retentionCents: 4_500,
      totalCents: 30_700,
      paymentStatus: "paid",
    }),
    document({
      fullNumber: "2026-0003",
      status: "voided",
      paymentStatus: null,
    }),
    document({
      documentType: "receipt",
      fullNumber: "REC-0001",
      subtotalCents: 12_100,
      taxBreakdown: [],
      totalCents: 12_100,
      paymentStatus: null,
    }),
  ];
  const sheet = buildPeriodSheet(documents);

  it("has one row per document plus header and totals", () => {
    expect(sheet.rows).toHaveLength(documents.length + 2);
    expect(sheet.rows[0]).toEqual([
      "Tipo",
      "Número",
      "Fecha",
      "Estado",
      "Cliente",
      "NIF cliente",
      "Base imponible",
      "Base IVA 21 %",
      "Cuota IVA 21 %",
      "Base IVA 10 %",
      "Cuota IVA 10 %",
      "Retención",
      "Total",
      "Cobro",
    ]);
  });

  it("writes stored amounts per tax type, retention and payment state", () => {
    expect(sheet.rows[2]).toEqual([
      "Factura",
      "2026-0002",
      "05/09/2026",
      "Emitido",
      "Cliente, S.L.",
      "B12345678",
      300,
      200,
      42,
      100,
      10,
      -45,
      307,
      "Pagada",
    ]);
    expect(sheet.rows[3]?.[3]).toBe("Anulado");
    expect(sheet.rows[4]?.slice(0, 2)).toEqual(["Recibo", "REC-0001"]);
    expect(sheet.rows[4]?.[7]).toBeNull();
  });

  it("totals equal the sum of non-voided rows", () => {
    const active = documents.filter((item) => item.status !== "voided");
    expect(sheet.totals.totalCents).toBe(
      active.reduce((sum, item) => sum + item.totalCents, 0),
    );
    expect(sheet.totals.subtotalCents).toBe(52_100);
    expect(sheet.totals.taxes).toEqual([
      { label: "IVA 21 %", baseCents: 30_000, taxCents: 6_300 },
      { label: "IVA 10 %", baseCents: 10_000, taxCents: 1_000 },
    ]);
    expect(sheet.rows.at(-1)).toEqual([
      "Total (sin anulados)",
      null,
      null,
      null,
      null,
      null,
      521,
      300,
      63,
      100,
      10,
      -45,
      549,
      null,
    ]);
  });

  it("formats every money cell", () => {
    expect(sheet.moneyCells).toContainEqual([1, 6]);
    expect(sheet.moneyCells).toContainEqual([5, 12]);
    expect(sheet.moneyCells).not.toContainEqual([1, 13]);
  });
});

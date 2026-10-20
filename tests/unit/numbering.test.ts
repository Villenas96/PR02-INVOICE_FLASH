import { describe, expect, it } from "vitest";

import {
  allocateDocumentNumber,
  autoSeriesPrefix,
  formatFullNumber,
  rolloverAnnualSeries,
  selectDefaultSeries,
} from "@/lib/numbering";

type DocumentType = "invoice" | "proforma" | "receipt";

interface NumberSeries {
  id: string;
  documentType: DocumentType;
  prefix: string;
  nextNumber: number;
  isDefault: boolean;
}

const invoiceSeries: NumberSeries = {
  id: "invoice-2026",
  documentType: "invoice",
  prefix: "2026-",
  nextNumber: 1,
  isDefault: true,
};

describe("document numbering", () => {
  it("builds full numbers with at least four numeric digits", () => {
    expect(formatFullNumber("2026-", 1)).toBe("2026-0001");
    expect(formatFullNumber("F-", 42)).toBe("F-0042");
    expect(formatFullNumber("F-", 12_345)).toBe("F-12345");
  });

  it("allocates the full number and advances an immutable series", () => {
    const result = allocateDocumentNumber("issued", invoiceSeries);

    expect(result).toEqual({
      assignment: {
        seriesId: "invoice-2026",
        number: 1,
        fullNumber: "2026-0001",
      },
      series: {
        ...invoiceSeries,
        nextNumber: 2,
      },
    });
    expect(invoiceSeries.nextNumber).toBe(1);
  });

  it("selects the default series for the requested document type", () => {
    const series: NumberSeries[] = [
      { ...invoiceSeries, id: "invoice-old", isDefault: false },
      invoiceSeries,
      {
        id: "proforma-2026",
        documentType: "proforma",
        prefix: "P-2026-",
        nextNumber: 7,
        isDefault: true,
      },
    ];

    expect(selectDefaultSeries(series, "invoice")).toEqual(invoiceSeries);
    expect(selectDefaultSeries(series, "proforma")).toMatchObject({
      id: "proforma-2026",
      documentType: "proforma",
    });
    expect(() => selectDefaultSeries(series, "receipt")).toThrow(
      "serie predeterminada",
    );
  });

  it("leaves drafts without a series or number and does not consume the counter", () => {
    const series = { ...invoiceSeries, nextNumber: 18 };

    expect(allocateDocumentNumber("draft", series)).toEqual({
      assignment: {
        seriesId: null,
        number: null,
        fullNumber: null,
      },
      series,
    });
    expect(series.nextNumber).toBe(18);
  });

  it("rolls over to a new annual default without changing prior correlation", () => {
    const previousSeries = {
      ...invoiceSeries,
      nextNumber: 38,
    };

    const result = rolloverAnnualSeries(previousSeries, {
      id: "invoice-2027",
      prefix: "2027-",
      initialNumber: 1,
    });

    expect(result.previousSeries).toEqual({
      ...previousSeries,
      isDefault: false,
    });
    expect(result.newSeries).toEqual({
      id: "invoice-2027",
      documentType: "invoice",
      prefix: "2027-",
      nextNumber: 1,
      isDefault: true,
    });
    expect(previousSeries).toEqual({
      ...invoiceSeries,
      nextNumber: 38,
    });
  });
});

describe("automatic series prefixes (FR-019, research R7)", () => {
  it("derives each type's prefix from the invoice series prefix", () => {
    expect(autoSeriesPrefix("proforma", "2026-", [])).toEqual({
      prefix: "PRO-2026-",
      renamed: false,
    });
    expect(autoSeriesPrefix("receipt", "2026-", [])).toEqual({
      prefix: "REC-2026-",
      renamed: false,
    });
    expect(autoSeriesPrefix("quote", "F-2026-", [])).toEqual({
      prefix: "PRE-F-2026-",
      renamed: false,
    });
    expect(autoSeriesPrefix("delivery_note", "2026-", [])).toEqual({
      prefix: "ALB-2026-",
      renamed: false,
    });
  });

  it("uses only the type code when the invoice prefix is empty", () => {
    expect(autoSeriesPrefix("quote", "", [])).toEqual({
      prefix: "PRE-",
      renamed: false,
    });
  });

  it("adds a numeric suffix to the code when the prefix already exists", () => {
    expect(autoSeriesPrefix("quote", "2026-", ["PRE-2026-"])).toEqual({
      prefix: "PRE2-2026-",
      renamed: true,
    });
    expect(
      autoSeriesPrefix("quote", "2026-", ["PRE-2026-", "PRE2-2026-"]),
    ).toEqual({ prefix: "PRE3-2026-", renamed: true });
  });
});

import { describe, expect, it } from "vitest";

import {
  copyLinesForConversion,
  decideConversionCreation,
  validateConversionSource,
} from "@/lib/documents/conversion";

describe("validateConversionSource", () => {
  it("accepts an issued proforma that has not been converted yet", () => {
    expect(
      validateConversionSource({
        documentType: "proforma",
        status: "issued",
        convertedToId: null,
      }),
    ).toEqual({ valid: true });
  });

  it("rejects a non-proforma document", () => {
    expect(
      validateConversionSource({
        documentType: "invoice",
        status: "issued",
        convertedToId: null,
      }),
    ).toEqual({ valid: false, error: "not_a_proforma" });
  });

  it("rejects a proforma that has not been issued", () => {
    expect(
      validateConversionSource({
        documentType: "proforma",
        status: "draft",
        convertedToId: null,
      }),
    ).toEqual({ valid: false, error: "not_issued" });
  });

  it("rejects a proforma that was already converted", () => {
    expect(
      validateConversionSource({
        documentType: "proforma",
        status: "issued",
        convertedToId: "invoice-1",
      }),
    ).toEqual({ valid: false, error: "already_converted" });
  });
});

describe("copyLinesForConversion", () => {
  it("copies every line's values without keeping identity with the source", () => {
    const sourceLines = [
      {
        description: "Consultoría",
        quantity: "2.000",
        unitPriceCents: 5_000,
        taxRate: "21.00",
        discountPercentage: "0.00",
      },
    ];

    const copied = copyLinesForConversion(sourceLines);
    expect(copied).toEqual(sourceLines);
    expect(copied).not.toBe(sourceLines);
    expect(copied[0]).not.toBe(sourceLines[0]);

    sourceLines[0].description = "Cambiado tras convertir";
    expect(copied[0].description).toBe("Consultoría");
  });

  it("returns an empty array for a source without lines", () => {
    expect(copyLinesForConversion([])).toEqual([]);
  });
});

describe("decideConversionCreation", () => {
  it("creates a new draft the first time a proforma converts", () => {
    expect(decideConversionCreation(null)).toEqual({ action: "create_draft" });
  });

  it("reuses the already-linked invoice on every later conversion attempt", () => {
    expect(decideConversionCreation("invoice-1")).toEqual({
      action: "reuse_existing",
      documentId: "invoice-1",
    });
  });
});

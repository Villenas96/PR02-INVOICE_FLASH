import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { decodeCsvBytes } from "@/lib/csv/decode";
import {
  CsvTooLargeError,
  detectDelimiter,
  MAX_IMPORT_ROWS,
  parseCsv,
} from "@/lib/csv/detect";
import {
  missingRequiredFields,
  suggestCatalogMapping,
} from "@/lib/csv/map-columns";
import {
  normalizeDescription,
  parseCsvPrice,
  parseCsvTaxRate,
  validateCatalogRow,
} from "@/lib/csv/validate-catalog-row";

const fixture = (name: string) =>
  readFile(`tests/fixtures/csv/${name}`).then(
    (buffer) => new Uint8Array(buffer),
  );

describe("CSV decoding", () => {
  it("reads UTF-8 (with or without BOM)", () => {
    const bytes = new TextEncoder().encode("﻿descripción;precio\nCafé;1,50\n");
    expect(decodeCsvBytes(bytes)).toEqual({
      text: "descripción;precio\nCafé;1,50\n",
      encoding: "utf-8",
    });
  });

  it("falls back to Windows-1252 for Excel exports", async () => {
    const decoded = decodeCsvBytes(
      await fixture("catalog-latin1-semicolon.csv"),
    );
    expect(decoded.encoding).toBe("windows-1252");
    expect(decoded.text.startsWith("Descripción;Precio;IVA;Unidad")).toBe(true);
    expect(decoded.text).toContain("Revisión técnica 1");
  });
});

describe("CSV structure", () => {
  it("detects the delimiter from the header, ignoring quoted text", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter('"a;x",b,c')).toBe(",");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
    expect(detectDelimiter("solo")).toBe(";");
  });

  it("parses headers and rows, skipping blank lines", async () => {
    const parsed = parseCsv(
      decodeCsvBytes(await fixture("catalog-500.csv")).text,
    );
    expect(parsed.delimiter).toBe(",");
    expect(parsed.headers).toEqual(["descripcion", "precio", "iva", "unidad"]);
    expect(parsed.rows).toHaveLength(500);
    expect(parsed.rows[0]).toEqual([
      "Producto 0001 – referencia 1",
      "6.37",
      "10",
      "hora",
    ]);
  });

  it(`refuses more than ${MAX_IMPORT_ROWS} rows`, async () => {
    const text = decodeCsvBytes(await fixture("catalog-5001.csv")).text;
    expect(() => parseCsv(text)).toThrow(CsvTooLargeError);
  });
});

describe("column mapping", () => {
  it("suggests columns by header name, accents and case ignored", () => {
    expect(
      suggestCatalogMapping([
        "Descripción",
        "Precio unitario",
        "IVA %",
        "Unidad",
      ]),
    ).toEqual({ description: 0, unit_price: 1, tax_rate: 2, unit: 3 });
    expect(suggestCatalogMapping(["Referencia", "Concepto", "PVP"])).toEqual({
      description: 1,
      unit_price: 2,
      tax_rate: null,
      unit: null,
    });
  });

  it("reports the required columns that are missing", () => {
    const mapping = suggestCatalogMapping(["Nombre", "Notas"]);
    expect(missingRequiredFields(mapping)).toEqual(["unit_price"]);
  });
});

describe("row validation", () => {
  const mapping = { description: 0, unit_price: 1, tax_rate: 2, unit: 3 };

  it("converts comma decimals and thousands to cents", () => {
    expect(parseCsvPrice("12,45")).toBe(1245);
    expect(parseCsvPrice("1.234,56 €")).toBe(123_456);
    expect(parseCsvPrice("6.37")).toBe(637);
    expect(parseCsvPrice("1.234")).toBe(123_400);
    expect(parseCsvPrice("15")).toBe(1500);
    expect(() => parseCsvPrice("-3,00")).toThrow(/negativo/);
    expect(() => parseCsvPrice("1,234")).toThrow();
    expect(() => parseCsvPrice("abc")).toThrow();
  });

  it("parses tax percentages", () => {
    expect(parseCsvTaxRate("21")).toBe("21.00");
    expect(parseCsvTaxRate("10,5 %")).toBe("10.50");
    expect(parseCsvTaxRate("")).toBeNull();
    expect(() => parseCsvTaxRate("120")).toThrow();
  });

  it("returns a valid row", () => {
    expect(
      validateCatalogRow(
        ["  Hora de diseño ", "45,00", "21", "hora"],
        mapping,
        2,
      ),
    ).toEqual({
      ok: true,
      value: {
        description: "Hora de diseño",
        unitPriceCents: 4500,
        taxRate: "21.00",
        unit: "hora",
      },
    });
  });

  it("reports every problem of a row with its line", () => {
    const result = validateCatalogRow(
      ["", "-5", "abc", "x".repeat(25)],
      mapping,
      7,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors.map((error) => [error.line, error.field])).toEqual([
      [7, "description"],
      [7, "unit_price"],
      [7, "tax_rate"],
      [7, "unit"],
    ]);
    expect(result.errors[1]?.message).toMatch(/negativo/);
  });

  it("flags a missing price", () => {
    const result = validateCatalogRow(["Producto", "", "", ""], mapping, 3);
    expect(result).toMatchObject({
      ok: false,
      errors: [{ line: 3, field: "unit_price", message: "Falta el precio." }],
    });
  });

  it("normalizes descriptions for duplicate detection", () => {
    expect(normalizeDescription("  Hora   de DISEÑO ")).toBe(
      normalizeDescription("hora de diseno"),
    );
  });
});

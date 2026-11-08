import {
  catalogDescriptionSchema,
  catalogUnitPriceCentsSchema,
  catalogUnitSchema,
} from "@/lib/catalog/schema";
import { normalizeUnit } from "@/lib/units";

import type { CatalogMapping } from "./map-columns";

export interface CatalogRowValue {
  description: string;
  unitPriceCents: number;
  /** `"21.00"`, or `null` to use the default tax type. */
  taxRate: string | null;
  unit: string | null;
}

export interface CatalogRowError {
  /** 1-based line in the file, header included (row 1 = first data row → 2). */
  line: number;
  field: string;
  message: string;
}

export type CatalogRowResult =
  | { ok: true; value: CatalogRowValue }
  | { ok: false; errors: CatalogRowError[] };

/**
 * Spanish money text → cents: «1.234,56», «1234,56 €», «12.5». Negative
 * amounts are reported, never silently converted.
 */
export function parseCsvPrice(raw: string): number {
  const compact = raw.replace(/[€\s]/gu, "");
  if (/^-/.test(compact)) {
    throw new RangeError("El precio no puede ser negativo.");
  }
  let normalized = compact;
  if (compact.includes(",")) {
    // «1.234,56»: dots are thousands separators.
    normalized = compact.replaceAll(".", "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/u.test(compact)) {
    normalized = compact.replaceAll(".", "");
  }
  if (!/^\d+(\.\d{1,2})?$/u.test(normalized)) {
    throw new TypeError(
      "El precio debe ser un importe con un máximo de dos decimales.",
    );
  }
  const [integerPart = "0", fraction = ""] = normalized.split(".");
  const cents = Number(`${integerPart}${fraction.padEnd(2, "0")}`);
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError("El precio supera el importe máximo permitido.");
  }
  return cents;
}

/** «21», «21 %», «21,00», «10.5» → `"21.00"`; empty → `null`. */
export function parseCsvTaxRate(raw: string): string | null {
  const compact = raw.replace(/[%\s]/gu, "").replace(",", ".");
  if (compact === "") {
    return null;
  }
  if (!/^\d{1,2}(\.\d{1,2})?$/u.test(compact)) {
    throw new TypeError("El impuesto debe ser un porcentaje entre 0 y 99,99.");
  }
  return Number(compact).toFixed(2);
}

/** Duplicate key: case-, accent- and spacing-insensitive description. */
export function normalizeDescription(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

function cell(row: readonly string[], index: number | null): string {
  return index === null ? "" : (row[index] ?? "").trim();
}

export function validateCatalogRow(
  row: readonly string[],
  mapping: CatalogMapping,
  line: number,
): CatalogRowResult {
  const errors: CatalogRowError[] = [];
  const description = catalogDescriptionSchema.safeParse(
    cell(row, mapping.description),
  );
  if (!description.success) {
    errors.push({
      line,
      field: "description",
      message: description.error.issues[0]?.message ?? "Descripción no válida.",
    });
  }

  let unitPriceCents = 0;
  const rawPrice = cell(row, mapping.unit_price);
  if (rawPrice === "") {
    errors.push({ line, field: "unit_price", message: "Falta el precio." });
  } else {
    try {
      const parsed = catalogUnitPriceCentsSchema.safeParse(
        parseCsvPrice(rawPrice),
      );
      if (parsed.success) {
        unitPriceCents = parsed.data;
      } else {
        errors.push({
          line,
          field: "unit_price",
          message: parsed.error.issues[0]?.message ?? "Precio no válido.",
        });
      }
    } catch (error) {
      errors.push({
        line,
        field: "unit_price",
        message: error instanceof Error ? error.message : "Precio no válido.",
      });
    }
  }

  let taxRate: string | null = null;
  try {
    taxRate = parseCsvTaxRate(cell(row, mapping.tax_rate));
  } catch (error) {
    errors.push({
      line,
      field: "tax_rate",
      message: error instanceof Error ? error.message : "Impuesto no válido.",
    });
  }

  const unit = catalogUnitSchema.safeParse(
    normalizeUnit(cell(row, mapping.unit)),
  );
  if (!unit.success) {
    errors.push({
      line,
      field: "unit",
      message: "La unidad no puede superar 20 caracteres.",
    });
  }

  if (errors.length > 0 || !description.success) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      description: description.data,
      unitPriceCents,
      taxRate,
      unit: unit.success ? (unit.data ?? null) : null,
    },
  };
}

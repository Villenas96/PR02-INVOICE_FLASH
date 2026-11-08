/**
 * Measurement units (research R9, FR-030). Predefined units live in code;
 * each company can add its own (`measurement_unit`). Lines and products
 * store the unit text itself, frozen like the description.
 */
export const PREDEFINED_UNITS = [
  "unidad",
  "hora",
  "día",
  "mes",
  "kg",
  "g",
  "l",
  "m",
  "m²",
  "m³",
  "km",
  "servicio",
] as const;

export const MAX_UNIT_LENGTH = 20;

/** Trims and collapses inner spaces; empty → null (no unit printed). */
export function normalizeUnit(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  return normalized === "" ? null : normalized;
}

export function isPredefinedUnit(value: string): boolean {
  const lower = value.toLocaleLowerCase("es");
  return PREDEFINED_UNITS.some((unit) => unit === lower);
}

/** Case-insensitive comparison used for per-company uniqueness. */
export function unitKey(value: string): string {
  return normalizeUnit(value)?.toLocaleLowerCase("es") ?? "";
}

/** Predefined units followed by the company's own, without duplicates. */
export function mergeUnits(custom: readonly string[]): string[] {
  const seen = new Set<string>(PREDEFINED_UNITS.map((unit) => unitKey(unit)));
  const merged: string[] = [...PREDEFINED_UNITS];
  for (const unit of custom) {
    const normalized = normalizeUnit(unit);
    if (normalized && !seen.has(unitKey(normalized))) {
      seen.add(unitKey(normalized));
      merged.push(normalized);
    }
  }
  return merged;
}

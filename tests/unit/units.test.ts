import { describe, expect, it } from "vitest";

import {
  isPredefinedUnit,
  mergeUnits,
  normalizeUnit,
  PREDEFINED_UNITS,
  unitKey,
} from "@/lib/units";

describe("measurement units", () => {
  it("offers the predefined Spanish units", () => {
    expect(PREDEFINED_UNITS).toEqual([
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
    ]);
  });

  it("normalizes spacing and treats blanks as no unit", () => {
    expect(normalizeUnit("  caja   de 12 ")).toBe("caja de 12");
    expect(normalizeUnit("   ")).toBeNull();
    expect(normalizeUnit(null)).toBeNull();
  });

  it("compares units case-insensitively", () => {
    expect(isPredefinedUnit("Hora")).toBe(true);
    expect(isPredefinedUnit("palé")).toBe(false);
    expect(unitKey(" Palé ")).toBe(unitKey("palé"));
  });

  it("appends custom units after the predefined ones without duplicates", () => {
    expect(mergeUnits(["Palé", "hora", "palé", " "])).toEqual([
      ...PREDEFINED_UNITS,
      "Palé",
    ]);
  });
});

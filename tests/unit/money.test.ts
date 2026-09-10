import { describe, expect, it } from "vitest";

import {
  addCents,
  createCents,
  formatEur,
  parseEuroInput,
  roundHalfUp,
} from "@/lib/money";

describe("money", () => {
  it("accepts only integer cents", () => {
    expect(createCents(123)).toBe(123);
    expect(() => createCents(12.5)).toThrow("entero");
    expect(() => createCents(Number.NaN)).toThrow("entero");
  });

  it("adds cent values without losing precision", () => {
    expect(addCents(createCents(199), createCents(1))).toBe(200);
  });

  it("rounds rational values half-up to cents", () => {
    expect(roundHalfUp(1005n, 10n)).toBe(101);
    expect(roundHalfUp(1004n, 10n)).toBe(100);
    expect(roundHalfUp(-1005n, 10n)).toBe(-101);
  });

  it("formats euros from integer cents", () => {
    expect(formatEur(createCents(123456))).toBe("1.234,56 €");
    expect(formatEur(createCents(-1))).toBe("-0,01 €");
  });

  it("parses comma or dot decimal euro input exactly into cents", () => {
    expect(parseEuroInput("1.23")).toBe(123);
    expect(parseEuroInput("19,90")).toBe(1_990);
    expect(parseEuroInput("0")).toBe(0);
  });

  it("rejects prices with fractional cents or ambiguous separators", () => {
    expect(() => parseEuroInput("1,234")).toThrow(/dos decimales/i);
    expect(() => parseEuroInput("1.000,00")).toThrow(/precio/i);
  });
});

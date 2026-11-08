import { describe, expect, it } from "vitest";

import {
  formatIban,
  IBAN_ERROR_MESSAGE,
  isValidBic,
  normalizeIban,
  validateIban,
} from "@/lib/iban";

describe("IBAN (ISO 13616)", () => {
  it("normalizes spaces and case", () => {
    expect(normalizeIban(" es91 2100 0418 4502 0005 1332 ")).toBe(
      "ES9121000418450200051332",
    );
  });

  it("accepts valid IBANs from several countries", () => {
    for (const iban of [
      "ES9121000418450200051332",
      "DE89370400440532013000",
      "FR1420041010050500013M02606",
      "PT50000201231234567890154",
      "GB82WEST12345698765432",
    ]) {
      expect(validateIban(iban)).toEqual({ valid: true, iban });
    }
  });

  it("rejects a wrong checksum", () => {
    expect(validateIban("ES9121000418450200051333")).toEqual({
      valid: false,
      reason: "checksum",
    });
  });

  it("rejects the wrong length for the country", () => {
    expect(validateIban("ES91210004184502000513")).toEqual({
      valid: false,
      reason: "length",
    });
  });

  it("rejects unknown countries and malformed input", () => {
    expect(validateIban("XX12345")).toEqual({
      valid: false,
      reason: "country",
    });
    expect(validateIban("ES91-2100")).toEqual({
      valid: false,
      reason: "format",
    });
  });

  it("never echoes the value in the error message", () => {
    expect(IBAN_ERROR_MESSAGE).not.toMatch(/\d{4}/);
    expect(IBAN_ERROR_MESSAGE).toMatch(/IBAN/);
  });

  it("formats in groups of four for display", () => {
    expect(formatIban("ES9121000418450200051332")).toBe(
      "ES91 2100 0418 4502 0005 1332",
    );
  });
});

describe("BIC (ISO 9362)", () => {
  it("accepts 8 and 11 character codes", () => {
    expect(isValidBic("CAIXESBB")).toBe(true);
    expect(isValidBic("caixesbbxxx")).toBe(true);
  });

  it("rejects malformed codes", () => {
    expect(isValidBic("CAIX")).toBe(false);
    expect(isValidBic("CA1XESBBXXX")).toBe(false);
    expect(isValidBic("CAIXESBBXX")).toBe(false);
  });
});

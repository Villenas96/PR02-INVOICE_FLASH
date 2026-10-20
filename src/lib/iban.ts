/**
 * IBAN (ISO 13616) and BIC (ISO 9362) validation for collection methods
 * (FR-021, research R5). Errors never include the value: an IBAN must not
 * reach messages or logs.
 */

/** Total IBAN length per country (SEPA and common partners). */
const IBAN_LENGTHS: Record<string, number> = {
  AD: 24,
  AT: 20,
  BE: 16,
  BG: 22,
  CH: 21,
  CY: 28,
  CZ: 24,
  DE: 22,
  DK: 18,
  EE: 20,
  ES: 24,
  FI: 18,
  FR: 27,
  GB: 22,
  GI: 23,
  GR: 27,
  HR: 21,
  HU: 28,
  IE: 22,
  IS: 26,
  IT: 27,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  MC: 27,
  MT: 31,
  NL: 18,
  NO: 15,
  PL: 28,
  PT: 25,
  RO: 24,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  VA: 22,
};

export const IBAN_ERROR_MESSAGE =
  "El IBAN no es válido. Revisa el código de país, la longitud y los dígitos de control.";

export type IbanValidation =
  | { valid: true; iban: string }
  | { valid: false; reason: "format" | "country" | "length" | "checksum" };

export function normalizeIban(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

/** ISO 7064 mod-97-10 over the rearranged IBAN, digit by digit. */
function mod97(iban: string): number {
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;
  for (const character of rearranged) {
    const value =
      character >= "A" && character <= "Z"
        ? String(character.charCodeAt(0) - 55)
        : character;
    for (const digit of value) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder;
}

export function validateIban(value: string): IbanValidation {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) {
    return { valid: false, reason: "format" };
  }
  const expectedLength = IBAN_LENGTHS[iban.slice(0, 2)];
  if (!expectedLength) {
    return { valid: false, reason: "country" };
  }
  if (iban.length !== expectedLength) {
    return { valid: false, reason: "length" };
  }
  if (mod97(iban) !== 1) {
    return { valid: false, reason: "checksum" };
  }
  return { valid: true, iban };
}

export function isValidBic(value: string): boolean {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(
    value.trim().toUpperCase(),
  );
}

export function formatIban(iban: string): string {
  return normalizeIban(iban).replace(/(.{4})(?=.)/g, "$1 ");
}

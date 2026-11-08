/**
 * Duplicate detection for bank movements (FR-043, research R14): a
 * fingerprint of the movement's own data plus an `occurrence` ordinal, so
 * re-importing or overlapping statements adds nothing, while two genuinely
 * identical movements on the same day keep distinct occurrences.
 */

export interface FingerprintInput {
  /** Account identity, e.g. `entity-office-number` or the method id. */
  account: string;
  operationOn: string;
  valueOn: string | null;
  amountCents: number;
  concept: string;
  reference: string | null;
}

/** Accent-, case- and spacing-insensitive concept. */
export function normalizeConcept(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

export async function fingerprintOf(input: FingerprintInput): Promise<string> {
  const material = [
    input.account,
    input.operationOn,
    input.valueOn ?? "",
    String(input.amountCents),
    normalizeConcept(input.concept),
    input.reference ?? "",
  ].join("\u001f");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(material),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Fingerprints with their occurrence (1, 2, … for identical ones, in file order). */
export async function withOccurrences<T extends FingerprintInput>(
  movements: readonly T[],
): Promise<Array<T & { fingerprint: string; occurrence: number }>> {
  const seen = new Map<string, number>();
  const result: Array<T & { fingerprint: string; occurrence: number }> = [];
  for (const movement of movements) {
    const fingerprint = await fingerprintOf(movement);
    const occurrence = (seen.get(fingerprint) ?? 0) + 1;
    seen.set(fingerprint, occurrence);
    result.push({ ...movement, fingerprint, occurrence });
  }
  return result;
}

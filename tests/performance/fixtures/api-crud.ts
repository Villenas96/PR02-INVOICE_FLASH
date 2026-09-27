/**
 * Deterministic dataset for the CRUD p95 scenario (plan.md: "p95 < 300 ms en
 * operaciones CRUD"): a single company with a realistic, at-scale roster of
 * clients and issued documents, generated from fixed word lists (no
 * randomness) so the row count and shape are reproducible across runs.
 */
export const CLIENT_COUNT = 200;
export const DOCUMENT_COUNT = 300;

export interface ClientFixtureRow {
  id: string;
  name: string;
  taxId: string;
}

export interface DocumentFixtureRow {
  id: string;
  number: number;
  fullNumber: string;
  clientId: string;
  totalCents: number;
}

const NAME_STEMS = [
  "Panadería",
  "Ferretería",
  "Estudio",
  "Consultoría",
  "Talleres",
  "Clínica",
  "Gestoría",
  "Academia",
];
const NAME_NOUNS = [
  "Sol",
  "Luna",
  "Norte",
  "Sur",
  "Atlántico",
  "Ibérica",
  "Central",
  "Rural",
];

function taxIdFor(index: number): string {
  return `B${(20_000_000 + index).toString().padStart(8, "0").slice(0, 8)}`;
}

export function generateClientFixtures(
  count: number = CLIENT_COUNT,
): ClientFixtureRow[] {
  return Array.from({ length: count }, (_, index) => {
    const stem = NAME_STEMS[index % NAME_STEMS.length];
    const noun = NAME_NOUNS[(index * 5) % NAME_NOUNS.length];
    return {
      id: crypto.randomUUID(),
      name: `${stem} ${noun} ${index.toString().padStart(4, "0")}, S.L.`,
      taxId: taxIdFor(index),
    };
  });
}

export function generateDocumentFixtures(
  clientIds: readonly string[],
  count: number = DOCUMENT_COUNT,
): DocumentFixtureRow[] {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return {
      id: crypto.randomUUID(),
      number,
      fullNumber: `2026-${number.toString().padStart(4, "0")}`,
      clientId: clientIds[index % clientIds.length] as string,
      totalCents: 10_000 + (index % 50) * 100,
    };
  });
}

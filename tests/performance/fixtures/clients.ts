/**
 * Deterministic dataset for the client-search p95 scenario (FR-006, T078):
 * 5,000 synthetic clients for a single company, generated from fixed word
 * lists (no randomness) so the row count and shape are reproducible across
 * runs, plus one findable "needle" client buried in the haystack.
 */
export interface ClientFixtureRow {
  id: string;
  name: string;
  taxId: string;
}

export const CLIENT_FIXTURE_COUNT = 5_000;
export const SEARCH_NEEDLE_NAME = "Consultoría Objetivo de Búsqueda";
export const SEARCH_NEEDLE_TERM = "Objetivo de Búsqueda";

const COMPANY_SUFFIXES = ["S.L.", "S.A.", "S.L.U.", "Cooperativa"];
const NAME_STEMS = [
  "Panadería",
  "Ferretería",
  "Estudio",
  "Consultoría",
  "Talleres",
  "Clínica",
  "Gestoría",
  "Academia",
  "Distribuciones",
  "Suministros",
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
  "Digital",
  "Verde",
];

function taxIdFor(index: number): string {
  return `B${(10_000_000 + index).toString().padStart(8, "0").slice(0, 8)}`;
}

export function generateClientFixtures(
  count: number = CLIENT_FIXTURE_COUNT,
): ClientFixtureRow[] {
  const rows: ClientFixtureRow[] = Array.from({ length: count }, (_, index) => {
    const stem = NAME_STEMS[index % NAME_STEMS.length];
    const noun = NAME_NOUNS[(index * 7) % NAME_NOUNS.length];
    const suffix = COMPANY_SUFFIXES[index % COMPANY_SUFFIXES.length];
    return {
      id: crypto.randomUUID(),
      name: `${stem} ${noun} ${index.toString().padStart(4, "0")}, ${suffix}`,
      taxId: taxIdFor(index),
    };
  });

  rows.push({
    id: crypto.randomUUID(),
    name: SEARCH_NEEDLE_NAME,
    taxId: taxIdFor(count),
  });

  return rows;
}

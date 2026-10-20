import Papa from "papaparse";

export const MAX_IMPORT_ROWS = 5_000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export type CsvDelimiter = ";" | "," | "\t";
const CANDIDATES: readonly CsvDelimiter[] = [";", ",", "\t"];

export class CsvTooLargeError extends Error {
  constructor(public readonly rowCount: number) {
    super(
      `El archivo tiene ${rowCount} filas; el máximo es ${MAX_IMPORT_ROWS}.`,
    );
    this.name = "CsvTooLargeError";
  }
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let inQuotes = false;
  let count = 0;
  for (const character of line) {
    if (character === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && character === delimiter) {
      count += 1;
    }
  }
  return count;
}

/** The most frequent candidate in the header line; `;` on ties (Spain). */
export function detectDelimiter(text: string): CsvDelimiter {
  const header = text.split(/\r?\n/u, 1)[0] ?? "";
  let best: CsvDelimiter = ";";
  let bestCount = 0;
  for (const candidate of CANDIDATES) {
    const count = countOutsideQuotes(header, candidate);
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

export interface ParsedCsv {
  delimiter: CsvDelimiter;
  headers: string[];
  rows: string[][];
}

/** Parses the whole file; blank lines are ignored, the limit is enforced. */
export function parseCsv(text: string): ParsedCsv {
  const delimiter = detectDelimiter(text);
  const result = Papa.parse<string[]>(text, {
    delimiter,
    skipEmptyLines: "greedy",
  });
  const [headers = [], ...rows] = result.data;
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new CsvTooLargeError(rows.length);
  }
  return {
    delimiter,
    headers: headers.map((header) => header.trim()),
    rows,
  };
}

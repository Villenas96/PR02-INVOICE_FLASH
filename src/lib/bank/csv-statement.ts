import { normalizeHeader } from "@/lib/csv/map-columns";

import type { Norma43Movement } from "./norma43";

/**
 * Bank statements exported as CSV (FR-043): column mapping suggested by
 * header name, Spanish dates and signed amounts with comma decimals.
 */

export const BANK_FIELDS = [
  "operation_date",
  "value_date",
  "concept",
  "amount",
  "balance",
] as const;
export type BankField = (typeof BANK_FIELDS)[number];
export type BankMapping = Record<BankField, number | null>;

export const BANK_REQUIRED_FIELDS: readonly BankField[] = [
  "operation_date",
  "concept",
  "amount",
];

const SYNONYMS: Record<BankField, readonly string[]> = {
  operation_date: [
    "fecha",
    "fecha operacion",
    "fecha de operacion",
    "date",
    "f operacion",
  ],
  value_date: ["fecha valor", "f valor", "valor", "value date"],
  concept: [
    "concepto",
    "descripcion",
    "detalle",
    "movimiento",
    "concept",
    "description",
  ],
  amount: ["importe", "cantidad", "amount", "importe eur"],
  balance: ["saldo", "balance", "saldo eur"],
};

export function suggestBankMapping(headers: readonly string[]): BankMapping {
  const normalized = headers.map(normalizeHeader);
  const used = new Set<number>();
  const mapping = {} as BankMapping;
  // «Fecha valor» must win its own column before plain «Fecha».
  const order: BankField[] = [
    "value_date",
    "operation_date",
    "concept",
    "amount",
    "balance",
  ];
  for (const field of order) {
    const index = normalized.findIndex(
      (header, position) =>
        !used.has(position) && SYNONYMS[field].includes(header),
    );
    mapping[field] = index >= 0 ? index : null;
    if (index >= 0) {
      used.add(index);
    }
  }
  return mapping;
}

export function missingBankFields(mapping: BankMapping): BankField[] {
  return BANK_REQUIRED_FIELDS.filter((field) => mapping[field] === null);
}

/** `dd/mm/yyyy`, `dd-mm-yyyy` or `yyyy-mm-dd` → `yyyy-mm-dd`. */
export function parseBankDate(raw: string): string {
  const value = raw.trim();
  let year: number;
  let month: number;
  let day: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const spanish = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(value);
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (spanish) {
    day = Number(spanish[1]);
    month = Number(spanish[2]);
    year = Number(spanish[3]);
    if (year < 100) {
      year += 2000;
    }
  } else {
    throw new TypeError("La fecha debe ser dd/mm/aaaa.");
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new RangeError("La fecha no existe.");
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Signed amount in cents: «-1.234,56», «287,37 €», «+12.5». */
export function parseBankAmount(raw: string): number {
  let value = raw.replace(/[€\s]/gu, "");
  const negative = value.startsWith("-") || /^\(.*\)$/.test(value);
  value = value.replace(/^[-+(]+|\)$/g, "");
  if (value.includes(",")) {
    value = value.replaceAll(".", "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/u.test(value)) {
    value = value.replaceAll(".", "");
  }
  if (!/^\d+(\.\d{1,2})?$/u.test(value)) {
    throw new TypeError("El importe debe tener como máximo dos decimales.");
  }
  const [integer = "0", fraction = ""] = value.split(".");
  const cents = Number(`${integer}${fraction.padEnd(2, "0")}`);
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError("El importe es demasiado grande.");
  }
  return negative ? -cents : cents;
}

export interface BankRowError {
  line: number;
  field: BankField;
  message: string;
}

export interface CsvStatement {
  movements: Norma43Movement[];
  closingBalanceCents: number | null;
  closingBalanceOn: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  errors: BankRowError[];
}

function cell(row: readonly string[], index: number | null): string {
  return index === null ? "" : (row[index] ?? "").trim();
}

/** Rows (header excluded) → movements; every bad row is reported, none dropped silently. */
export function readCsvStatement(
  rows: readonly (readonly string[])[],
  mapping: BankMapping,
): CsvStatement {
  const movements: Norma43Movement[] = [];
  const errors: BankRowError[] = [];
  let lastBalance = null as { on: string; cents: number } | null;

  rows.forEach((row, index) => {
    const line = index + 2;
    const fail = (field: BankField, error: unknown) =>
      errors.push({
        line,
        field,
        message: error instanceof Error ? error.message : "Valor no válido.",
      });
    let operationOn = "";
    let valueOn: string | null = null;
    let amount = 0;
    try {
      operationOn = parseBankDate(cell(row, mapping.operation_date));
    } catch (error) {
      fail("operation_date", error);
    }
    if (cell(row, mapping.value_date) !== "") {
      try {
        valueOn = parseBankDate(cell(row, mapping.value_date));
      } catch (error) {
        fail("value_date", error);
      }
    }
    try {
      amount = parseBankAmount(cell(row, mapping.amount));
    } catch (error) {
      fail("amount", error);
    }
    const concept = cell(row, mapping.concept);
    if (concept === "") {
      fail("concept", new Error("Falta el concepto."));
    }
    if (errors.some((error) => error.line === line)) {
      return;
    }
    movements.push({
      operationOn,
      valueOn,
      amountCents: amount,
      concept,
      reference: null,
    });
    if (mapping.balance !== null && cell(row, mapping.balance) !== "") {
      try {
        const cents = parseBankAmount(cell(row, mapping.balance));
        if (!lastBalance || operationOn >= lastBalance.on) {
          lastBalance = { on: operationOn, cents };
        }
      } catch (error) {
        fail("balance", error);
      }
    }
  });

  const dates = movements.map((movement) => movement.operationOn).sort();
  return {
    movements,
    closingBalanceCents: lastBalance?.cents ?? null,
    closingBalanceOn: lastBalance?.on ?? null,
    periodStart: dates[0] ?? null,
    periodEnd: dates.at(-1) ?? null,
    errors,
  };
}

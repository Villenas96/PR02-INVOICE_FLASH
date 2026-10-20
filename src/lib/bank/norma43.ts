/**
 * Norma 43 (AEB43) parser, pure (research R14). Fixed-width 80-column
 * records: `11` account header, `22` movement, `23` complementary concept,
 * `33` account footer, `88` end of file. Encoding is ISO-8859-1; amounts
 * are 14 digits with two decimals and a debit/credit key (`1` debe = charge,
 * `2` haber = income).
 */

export interface Norma43Movement {
  /** `YYYY-MM-DD`. */
  operationOn: string;
  valueOn: string | null;
  /** Positive = income, negative = charge. */
  amountCents: number;
  concept: string;
  reference: string | null;
}

export interface Norma43Account {
  entity: string;
  office: string;
  number: string;
  periodStart: string;
  periodEnd: string;
  openingBalanceCents: number;
  closingBalanceCents: number | null;
  movements: Norma43Movement[];
}

export interface Norma43Statement {
  accounts: Norma43Account[];
}

export class Norma43Error extends Error {
  constructor(
    message: string,
    public readonly line: number,
  ) {
    super(`Línea ${line}: ${message}`);
    this.name = "Norma43Error";
  }
}

/** Latin-1 bytes → text (the format is not UTF-8). */
export function decodeNorma43(bytes: Uint8Array): string {
  return new TextDecoder("windows-1252").decode(bytes);
}

function field(line: string, from: number, to: number): string {
  return line.slice(from - 1, to);
}

function digits(value: string, lineNumber: number, what: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Norma43Error(`${what} no es numérico.`, lineNumber);
  }
  return Number(value);
}

function toIsoDate(value: string, lineNumber: number, what: string): string {
  if (!/^\d{6}$/.test(value)) {
    throw new Norma43Error(`${what} no es una fecha AAMMDD.`, lineNumber);
  }
  const year = 2000 + Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    month < 1 ||
    month > 12 ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Norma43Error(`${what} no es una fecha válida.`, lineNumber);
  }
  return `${year}-${value.slice(2, 4)}-${value.slice(4, 6)}`;
}

function signed(key: string, cents: number, lineNumber: number): number {
  if (key === "1") {
    return -cents;
  }
  if (key === "2") {
    return cents;
  }
  throw new Norma43Error("La clave debe/haber debe ser 1 o 2.", lineNumber);
}

interface Draft {
  account: Norma43Account;
  current: (Norma43Movement & { parts: string[] }) | null;
  debitCount: number;
  creditCount: number;
  debitCents: number;
  creditCents: number;
}

function closeMovement(draft: Draft): void {
  const movement = draft.current;
  if (!movement) {
    return;
  }
  const { parts, ...rest } = movement;
  draft.account.movements.push({
    ...rest,
    concept: parts.join(" ").replace(/\s+/g, " ").trim(),
  });
  draft.current = null;
}

/**
 * Parses and cross-checks a statement: the totals of record `33` must match
 * the movements read (counts and amounts), so a truncated or corrupted file
 * is rejected instead of silently importing part of it.
 */
export function parseNorma43(text: string): Norma43Statement {
  const lines = text
    .split(/\r?\n/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => line.trim() !== "");
  const accounts: Norma43Account[] = [];
  let draft: Draft | null = null;
  let ended = false;

  for (const { line: rawLine, number } of lines) {
    if (rawLine.length > 80) {
      throw new Norma43Error(
        "Los registros miden como máximo 80 columnas.",
        number,
      );
    }
    const line = rawLine.padEnd(80, " ");
    const kind = field(line, 1, 2);

    if (ended) {
      throw new Norma43Error(
        "Hay registros después del fin de fichero.",
        number,
      );
    }
    switch (kind) {
      case "11": {
        if (draft) {
          throw new Norma43Error(
            "Falta el registro 33 de la cuenta anterior.",
            number,
          );
        }
        const key = field(line, 33, 33);
        const account: Norma43Account = {
          entity: field(line, 3, 6),
          office: field(line, 7, 10),
          number: field(line, 11, 20),
          periodStart: toIsoDate(
            field(line, 21, 26),
            number,
            "La fecha inicial",
          ),
          periodEnd: toIsoDate(field(line, 27, 32), number, "La fecha final"),
          openingBalanceCents: signed(
            key,
            digits(field(line, 34, 47), number, "El saldo inicial"),
            number,
          ),
          closingBalanceCents: null,
          movements: [],
        };
        draft = {
          account,
          current: null,
          debitCount: 0,
          creditCount: 0,
          debitCents: 0,
          creditCents: 0,
        };
        break;
      }
      case "22": {
        if (!draft) {
          throw new Norma43Error("Movimiento sin registro 11.", number);
        }
        closeMovement(draft);
        const cents = digits(field(line, 29, 42), number, "El importe");
        const amount = signed(field(line, 28, 28), cents, number);
        const valueOn = field(line, 17, 22);
        draft.current = {
          operationOn: toIsoDate(
            field(line, 11, 16),
            number,
            "La fecha de operación",
          ),
          valueOn: /^0+$/.test(valueOn)
            ? null
            : toIsoDate(valueOn, number, "La fecha valor"),
          amountCents: amount,
          concept: "",
          reference: /^0*$/.test(field(line, 43, 52))
            ? null
            : field(line, 43, 52).replace(/^0+/, ""),
          parts: [],
        };
        if (amount < 0) {
          draft.debitCount += 1;
          draft.debitCents += -amount;
        } else {
          draft.creditCount += 1;
          draft.creditCents += amount;
        }
        break;
      }
      case "23": {
        if (!draft?.current) {
          throw new Norma43Error("Concepto sin movimiento previo.", number);
        }
        draft.current.parts.push(
          field(line, 5, 42).trim(),
          field(line, 43, 80).trim(),
        );
        draft.current.parts = draft.current.parts.filter(Boolean);
        break;
      }
      case "33": {
        if (!draft) {
          throw new Norma43Error("Registro 33 sin registro 11.", number);
        }
        closeMovement(draft);
        const debitCount = digits(
          field(line, 21, 25),
          number,
          "El nº de debes",
        );
        const debitCents = digits(
          field(line, 26, 39),
          number,
          "El total de debes",
        );
        const creditCount = digits(
          field(line, 40, 44),
          number,
          "El nº de haberes",
        );
        const creditCents = digits(
          field(line, 45, 58),
          number,
          "El total de haberes",
        );
        if (
          debitCount !== draft.debitCount ||
          creditCount !== draft.creditCount ||
          debitCents !== draft.debitCents ||
          creditCents !== draft.creditCents
        ) {
          throw new Norma43Error(
            "Los totales del registro 33 no cuadran con los movimientos.",
            number,
          );
        }
        draft.account.closingBalanceCents = signed(
          field(line, 59, 59),
          digits(field(line, 60, 73), number, "El saldo final"),
          number,
        );
        accounts.push(draft.account);
        draft = null;
        break;
      }
      case "88": {
        if (draft) {
          throw new Norma43Error("Falta el registro 33 de la cuenta.", number);
        }
        ended = true;
        break;
      }
      default:
        throw new Norma43Error(
          `Tipo de registro desconocido «${kind}».`,
          number,
        );
    }
  }
  if (draft) {
    throw new Norma43Error(
      "El fichero termina sin el registro 33.",
      lines.length,
    );
  }
  if (accounts.length === 0) {
    throw new Norma43Error("El fichero no contiene ninguna cuenta.", 1);
  }
  return { accounts };
}

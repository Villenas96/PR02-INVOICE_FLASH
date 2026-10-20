export type DocumentType =
  | "invoice"
  | "proforma"
  | "receipt"
  | "quote"
  | "delivery_note";
export type NumberAllocationStatus = "draft" | "issued";

export interface NumberSeries {
  id: string;
  documentType: DocumentType;
  prefix: string;
  nextNumber: number;
  isDefault: boolean;
}

export interface DocumentNumberAssignment {
  seriesId: string | null;
  number: number | null;
  fullNumber: string | null;
}

export interface NumberAllocation<TSeries extends NumberSeries> {
  assignment: DocumentNumberAssignment;
  series: TSeries;
}

export interface AnnualSeriesRollover {
  id: string;
  prefix: string;
  initialNumber: number;
}

export interface AnnualSeriesRolloverResult<TSeries extends NumberSeries> {
  previousSeries: TSeries;
  newSeries: TSeries;
}

const MINIMUM_NUMBER_DIGITS = 4;

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${field} no puede estar vacío.`);
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} debe ser un entero positivo seguro.`);
  }
}

function assertValidSeries(series: NumberSeries): void {
  assertNonEmpty(series.id, "El identificador de la serie");
  assertPositiveInteger(series.nextNumber, "El siguiente número");
}

export function formatFullNumber(prefix: string, number: number): string {
  assertPositiveInteger(number, "El número del documento");
  return `${prefix}${number.toString().padStart(MINIMUM_NUMBER_DIGITS, "0")}`;
}

export function allocateDocumentNumber<TSeries extends NumberSeries>(
  status: NumberAllocationStatus,
  series: TSeries,
): NumberAllocation<TSeries> {
  assertValidSeries(series);

  if (status === "draft") {
    return {
      assignment: {
        seriesId: null,
        number: null,
        fullNumber: null,
      },
      series: { ...series },
    };
  }

  if (status !== "issued") {
    throw new Error("Solo un borrador o una emisión pueden reservar número.");
  }

  if (series.nextNumber === Number.MAX_SAFE_INTEGER) {
    throw new Error("La serie ha agotado los números enteros seguros.");
  }

  return {
    assignment: {
      seriesId: series.id,
      number: series.nextNumber,
      fullNumber: formatFullNumber(series.prefix, series.nextNumber),
    },
    series: {
      ...series,
      nextNumber: series.nextNumber + 1,
    },
  };
}

export function selectDefaultSeries<TSeries extends NumberSeries>(
  series: readonly TSeries[],
  documentType: DocumentType,
): TSeries {
  const candidates = series.filter(
    (candidate) =>
      candidate.documentType === documentType && candidate.isDefault,
  );

  if (candidates.length === 0) {
    throw new Error(
      `No existe una serie predeterminada para el tipo ${documentType}.`,
    );
  }

  if (candidates.length > 1) {
    throw new Error(
      `Existe más de una serie predeterminada para el tipo ${documentType}.`,
    );
  }

  const selected = candidates[0];
  if (!selected) {
    throw new Error(
      `No existe una serie predeterminada para el tipo ${documentType}.`,
    );
  }

  assertValidSeries(selected);
  return selected;
}

export function rolloverAnnualSeries<TSeries extends NumberSeries>(
  previousSeries: TSeries,
  rollover: AnnualSeriesRollover,
): AnnualSeriesRolloverResult<TSeries> {
  assertValidSeries(previousSeries);
  assertNonEmpty(rollover.id, "El identificador de la nueva serie");
  assertNonEmpty(rollover.prefix, "El prefijo de la nueva serie");
  assertPositiveInteger(rollover.initialNumber, "El número inicial");

  if (!previousSeries.isDefault) {
    throw new Error(
      "Solo la serie predeterminada actual puede iniciar el rollover anual.",
    );
  }

  if (rollover.id === previousSeries.id) {
    throw new Error("La nueva serie debe tener un identificador diferente.");
  }

  if (rollover.prefix === previousSeries.prefix) {
    throw new Error("La nueva serie anual debe tener un prefijo diferente.");
  }

  return {
    previousSeries: {
      ...previousSeries,
      isDefault: false,
    },
    newSeries: {
      ...previousSeries,
      id: rollover.id,
      prefix: rollover.prefix,
      nextNumber: rollover.initialNumber,
      isDefault: true,
    },
  };
}

/** Code prepended to the invoice prefix for every other type (R7). */
export const SERIES_TYPE_CODES: Record<
  Exclude<DocumentType, "invoice">,
  string
> = {
  proforma: "PRO",
  receipt: "REC",
  quote: "PRE",
  delivery_note: "ALB",
};

/**
 * Prefix of the automatic default series of a type (FR-019): the type code
 * plus the invoice series prefix (`PRE-` + `2026-` → `PRE-2026-`). A
 * collision with any existing prefix appends a counter to the code
 * (`PRE2-2026-`) and reports `renamed` so the user is told.
 */
export function autoSeriesPrefix(
  documentType: Exclude<DocumentType, "invoice">,
  invoicePrefix: string,
  existingPrefixes: readonly string[],
): { prefix: string; renamed: boolean } {
  const code = SERIES_TYPE_CODES[documentType];
  const taken = new Set(existingPrefixes);
  const base = `${code}-${invoicePrefix}`;
  if (!taken.has(base)) {
    return { prefix: base, renamed: false };
  }
  for (let counter = 2; ; counter += 1) {
    const candidate = `${code}${counter}-${invoicePrefix}`;
    if (!taken.has(candidate)) {
      return { prefix: candidate, renamed: true };
    }
  }
}

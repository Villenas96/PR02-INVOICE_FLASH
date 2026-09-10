import { type Cents, createCents, roundHalfUp } from "@/lib/money";

const QUANTITY_SCALE = 1_000n;
const PERCENTAGE_SCALE = 10_000n;
const MAX_PERCENTAGE = 10_000n;

export interface BillingLineInput {
  quantity: string;
  unitPriceCents: Cents;
  taxRate: string;
  discountPercentage?: string;
}

export interface BillingInput {
  lines: BillingLineInput[];
  retentionRate?: string;
}

export interface BillingLineResult {
  subtotalCents: Cents;
  taxCents: Cents;
  totalCents: Cents;
}

export interface TaxBreakdownEntry {
  rate: string;
  baseCents: Cents;
  taxCents: Cents;
}

export interface BillingResult {
  lines: BillingLineResult[];
  taxBreakdown: TaxBreakdownEntry[];
  subtotalCents: Cents;
  retentionCents: Cents;
  totalCents: Cents;
}

interface AccumulatedTax {
  rateBasisPoints: bigint;
  baseCents: bigint;
  taxCents: bigint;
}

function parseScaledDecimal(
  value: string,
  scale: number,
  fieldName: string,
): bigint {
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new TypeError(`${fieldName} debe ser un decimal positivo válido.`);
  }

  const [integerPart, fractionalPart = ""] = value.split(".");
  if (fractionalPart.length > scale) {
    throw new RangeError(`${fieldName} admite como máximo ${scale} decimales.`);
  }

  const scaleFactor = 10n ** BigInt(scale);
  const scaledFraction = fractionalPart.padEnd(scale, "0");

  return (
    BigInt(integerPart) * scaleFactor +
    BigInt(scaledFraction.length === 0 ? "0" : scaledFraction)
  );
}

function parseQuantity(value: string): bigint {
  const quantity = parseScaledDecimal(value, 3, "La cantidad");
  if (quantity <= 0n) {
    throw new RangeError("La cantidad debe ser mayor que cero.");
  }
  return quantity;
}

function parsePercentage(
  value: string,
  fieldName: string,
  maximumInclusive: boolean,
): bigint {
  const percentage = parseScaledDecimal(value, 2, fieldName);
  const exceedsMaximum = maximumInclusive
    ? percentage > MAX_PERCENTAGE
    : percentage >= MAX_PERCENTAGE;

  if (exceedsMaximum) {
    const operator = maximumInclusive ? "como máximo" : "menor que";
    throw new RangeError(`${fieldName} debe ser ${operator} 100.`);
  }

  return percentage;
}

function validateUnitPrice(value: Cents): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      "El precio unitario debe ser un entero no negativo en céntimos.",
    );
  }
  return BigInt(value);
}

function centsFromBigInt(value: bigint): Cents {
  if (
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new RangeError("El importe supera el rango seguro de céntimos.");
  }
  return createCents(Number(value));
}

function formatPercentage(basisPoints: bigint): string {
  const integerPart = basisPoints / 100n;
  const fractionalPart = (basisPoints % 100n).toString().padStart(2, "0");
  return `${integerPart}.${fractionalPart}`;
}

function calculateLine(line: BillingLineInput): {
  result: BillingLineResult;
  taxBasisPoints: bigint;
} {
  const quantity = parseQuantity(line.quantity);
  const unitPriceCents = validateUnitPrice(line.unitPriceCents);
  const discountBasisPoints = parsePercentage(
    line.discountPercentage ?? "0",
    "El descuento",
    true,
  );
  const taxBasisPoints = parsePercentage(
    line.taxRate,
    "El tipo impositivo",
    false,
  );
  const subtotalCents = roundHalfUp(
    quantity * unitPriceCents * (PERCENTAGE_SCALE - discountBasisPoints),
    QUANTITY_SCALE * PERCENTAGE_SCALE,
  );
  const taxCents = roundHalfUp(
    BigInt(subtotalCents) * taxBasisPoints,
    PERCENTAGE_SCALE,
  );
  const totalCents = centsFromBigInt(BigInt(subtotalCents) + BigInt(taxCents));

  return {
    result: {
      subtotalCents,
      taxCents,
      totalCents,
    },
    taxBasisPoints,
  };
}

export function calculateBilling(input: BillingInput): BillingResult {
  if (input.lines.length === 0) {
    throw new RangeError("El documento debe incluir al menos una línea.");
  }

  const retentionBasisPoints = parsePercentage(
    input.retentionRate ?? "0",
    "La retención",
    true,
  );
  const taxByRate = new Map<string, AccumulatedTax>();
  const lines: BillingLineResult[] = [];
  let subtotal = 0n;
  let totalTax = 0n;

  for (const line of input.lines) {
    const calculation = calculateLine(line);
    const lineSubtotal = BigInt(calculation.result.subtotalCents);
    const lineTax = BigInt(calculation.result.taxCents);
    const rateKey = calculation.taxBasisPoints.toString();
    const accumulated = taxByRate.get(rateKey) ?? {
      rateBasisPoints: calculation.taxBasisPoints,
      baseCents: 0n,
      taxCents: 0n,
    };

    accumulated.baseCents += lineSubtotal;
    accumulated.taxCents += lineTax;
    taxByRate.set(rateKey, accumulated);
    subtotal += lineSubtotal;
    totalTax += lineTax;
    lines.push(calculation.result);
  }

  const retentionCents = roundHalfUp(
    subtotal * retentionBasisPoints,
    PERCENTAGE_SCALE,
  );
  const taxBreakdown = Array.from(taxByRate.values())
    .sort((left, right) =>
      left.rateBasisPoints < right.rateBasisPoints ? -1 : 1,
    )
    .map(
      (entry): TaxBreakdownEntry => ({
        rate: formatPercentage(entry.rateBasisPoints),
        baseCents: centsFromBigInt(entry.baseCents),
        taxCents: centsFromBigInt(entry.taxCents),
      }),
    );

  return {
    lines,
    taxBreakdown,
    subtotalCents: centsFromBigInt(subtotal),
    retentionCents,
    totalCents: centsFromBigInt(subtotal + totalTax - BigInt(retentionCents)),
  };
}

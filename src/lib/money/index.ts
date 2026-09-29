declare const centsBrand: unique symbol;

/** Monetary value expressed as an exact, integer number of euro cents. */
export type Cents = number & { readonly [centsBrand]: "Cents" };

const euroIntegerFormatter = new Intl.NumberFormat("es-ES", {
  maximumFractionDigits: 0,
  useGrouping: true,
});

export function createCents(value: number): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError("Un importe en céntimos debe ser un entero seguro.");
  }

  return value as Cents;
}

export function addCents(...values: Cents[]): Cents {
  return createCents(values.reduce((total, value) => total + value, 0));
}

/** Rounds a fraction to the nearest integer, resolving exact halves away from zero. */
export function roundHalfUp(numerator: bigint, denominator: bigint): Cents {
  if (denominator <= 0n) {
    throw new RangeError("El denominador debe ser positivo.");
  }

  const sign = numerator < 0n ? -1n : 1n;
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const quotient = absoluteNumerator / denominator;
  const remainder = absoluteNumerator % denominator;
  const rounded = quotient + (remainder * 2n >= denominator ? 1n : 0n);
  const result = sign * rounded;

  if (
    result > BigInt(Number.MAX_SAFE_INTEGER) ||
    result < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new RangeError("El importe supera el rango seguro de céntimos.");
  }

  return createCents(Number(result));
}

export function formatEur(value: Cents): string {
  const absoluteValue = Math.abs(value);
  const euros = Math.trunc(absoluteValue / 100);
  const cents = absoluteValue % 100;
  const sign = value < 0 ? "-" : "";

  return `${sign}${euroIntegerFormatter.format(euros)},${cents.toString().padStart(2, "0")} €`;
}

export function parseEuroInput(value: string): Cents {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) {
    throw new TypeError(
      "El precio debe ser un importe positivo con un máximo de dos decimales.",
    );
  }

  const [integerPart, fractionalPart = ""] = normalized.split(".");
  const cents = Number(`${integerPart}${fractionalPart.padEnd(2, "0")}`);
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError("El precio supera el importe máximo permitido.");
  }

  return createCents(cents);
}

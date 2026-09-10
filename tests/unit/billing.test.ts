import { describe, expect, it } from "vitest";

import { calculateBilling } from "@/lib/billing";
import { createCents } from "@/lib/money";

interface GeneratedLine {
  quantity: string;
  unitPriceCents: ReturnType<typeof createCents>;
  taxRate: string;
  discountPercentage: string;
}

interface BillingResult {
  lines: Array<{
    subtotalCents: number;
    taxCents: number;
    totalCents: number;
  }>;
  taxBreakdown: Array<{
    rate: string;
    baseCents: number;
    taxCents: number;
  }>;
  subtotalCents: number;
  retentionCents: number;
  totalCents: number;
}

function roundHalfUpPositive(numerator: bigint, denominator: bigint): number {
  return Number((numerator + denominator / 2n) / denominator);
}

function formatScaled(value: number, scale: number): string {
  const divisor = 10 ** scale;
  const integerPart = Math.trunc(value / divisor);
  const fractionalPart = (value % divisor).toString().padStart(scale, "0");
  return `${integerPart}.${fractionalPart}`;
}

function deterministicIntegerGenerator(seed: number) {
  let state = BigInt(seed);

  return (maximumExclusive: number): number => {
    state = (state * 48_271n) % 2_147_483_647n;
    return Number(state % BigInt(maximumExclusive));
  };
}

describe("billing calculations", () => {
  it("applies a percentage discount before calculating tax", () => {
    const result: BillingResult = calculateBilling({
      lines: [
        {
          quantity: "2.000",
          unitPriceCents: createCents(1_000),
          taxRate: "21.00",
          discountPercentage: "12.50",
        },
      ],
      retentionRate: "0.00",
    });

    expect(result.lines).toEqual([
      {
        subtotalCents: 1_750,
        taxCents: 368,
        totalCents: 2_118,
      },
    ]);
    expect(result).toMatchObject({
      subtotalCents: 1_750,
      retentionCents: 0,
      totalCents: 2_118,
    });
  });

  it("rounds bases and taxes half-up for each line before aggregation", () => {
    const result: BillingResult = calculateBilling({
      lines: [
        {
          quantity: "0.125",
          unitPriceCents: createCents(100),
          taxRate: "0.00",
          discountPercentage: "0.00",
        },
        {
          quantity: "1.000",
          unitPriceCents: createCents(5),
          taxRate: "10.00",
          discountPercentage: "0.00",
        },
        {
          quantity: "1.000",
          unitPriceCents: createCents(5),
          taxRate: "10.00",
          discountPercentage: "0.00",
        },
      ],
      retentionRate: "0.00",
    });

    expect(result.lines).toEqual([
      { subtotalCents: 13, taxCents: 0, totalCents: 13 },
      { subtotalCents: 5, taxCents: 1, totalCents: 6 },
      { subtotalCents: 5, taxCents: 1, totalCents: 6 },
    ]);
    expect(result).toMatchObject({
      subtotalCents: 23,
      retentionCents: 0,
      totalCents: 25,
    });
  });

  it("aggregates mixed tax rates into separate breakdown entries", () => {
    const result: BillingResult = calculateBilling({
      lines: [
        {
          quantity: "1.000",
          unitPriceCents: createCents(1_000),
          taxRate: "21.00",
          discountPercentage: "0.00",
        },
        {
          quantity: "1.000",
          unitPriceCents: createCents(500),
          taxRate: "10.00",
          discountPercentage: "0.00",
        },
        {
          quantity: "1.000",
          unitPriceCents: createCents(250),
          taxRate: "21.00",
          discountPercentage: "0.00",
        },
      ],
      retentionRate: "0.00",
    });

    expect(result.taxBreakdown).toHaveLength(2);
    expect(result.taxBreakdown).toEqual(
      expect.arrayContaining([
        { rate: "10.00", baseCents: 500, taxCents: 50 },
        { rate: "21.00", baseCents: 1_250, taxCents: 263 },
      ]),
    );
    expect(result).toMatchObject({
      subtotalCents: 1_750,
      retentionCents: 0,
      totalCents: 2_063,
    });
  });

  it("rounds retention half-up over the global subtotal and subtracts it", () => {
    const result: BillingResult = calculateBilling({
      lines: [
        {
          quantity: "1.000",
          unitPriceCents: createCents(1_010),
          taxRate: "21.00",
          discountPercentage: "0.00",
        },
      ],
      retentionRate: "15.00",
    });

    expect(result).toMatchObject({
      subtotalCents: 1_010,
      retentionCents: 152,
      totalCents: 1_070,
    });
    expect(result.lines[0]).toEqual({
      subtotalCents: 1_010,
      taxCents: 212,
      totalCents: 1_222,
    });
  });

  it("preserves exact integer-cent invariants across deterministic generated cases", () => {
    const nextInteger = deterministicIntegerGenerator(20_260_730);

    for (let caseIndex = 0; caseIndex < 128; caseIndex += 1) {
      const lineCount = nextInteger(5) + 1;
      const lines: GeneratedLine[] = [];
      const expectedLines: Array<{
        subtotalCents: number;
        taxCents: number;
        totalCents: number;
      }> = [];

      for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
        const quantityMilliunits = nextInteger(20_000) + 1;
        const unitPriceCents = nextInteger(1_000_000);
        const taxBasisPoints = nextInteger(3_001);
        const discountBasisPoints = nextInteger(10_001);
        const subtotalCents = roundHalfUpPositive(
          BigInt(quantityMilliunits) *
            BigInt(unitPriceCents) *
            BigInt(10_000 - discountBasisPoints),
          10_000_000n,
        );
        const taxCents = roundHalfUpPositive(
          BigInt(subtotalCents) * BigInt(taxBasisPoints),
          10_000n,
        );

        lines.push({
          quantity: formatScaled(quantityMilliunits, 3),
          unitPriceCents: createCents(unitPriceCents),
          taxRate: formatScaled(taxBasisPoints, 2),
          discountPercentage: formatScaled(discountBasisPoints, 2),
        });
        expectedLines.push({
          subtotalCents,
          taxCents,
          totalCents: subtotalCents + taxCents,
        });
      }

      const retentionBasisPoints = nextInteger(3_001);
      const expectedSubtotal = expectedLines.reduce(
        (sum, line) => sum + line.subtotalCents,
        0,
      );
      const expectedTax = expectedLines.reduce(
        (sum, line) => sum + line.taxCents,
        0,
      );
      const expectedRetention = roundHalfUpPositive(
        BigInt(expectedSubtotal) * BigInt(retentionBasisPoints),
        10_000n,
      );
      const result: BillingResult = calculateBilling({
        lines,
        retentionRate: formatScaled(retentionBasisPoints, 2),
      });

      expect(result.lines).toEqual(expectedLines);
      expect(result.subtotalCents).toBe(expectedSubtotal);
      expect(
        result.taxBreakdown.reduce(
          (sum, breakdown) => sum + breakdown.taxCents,
          0,
        ),
      ).toBe(expectedTax);
      expect(result.retentionCents).toBe(expectedRetention);
      expect(result.totalCents).toBe(
        expectedSubtotal + expectedTax - expectedRetention,
      );

      for (const monetaryValue of [
        result.subtotalCents,
        result.retentionCents,
        result.totalCents,
        ...result.lines.flatMap((line) => [
          line.subtotalCents,
          line.taxCents,
          line.totalCents,
        ]),
        ...result.taxBreakdown.flatMap((breakdown) => [
          breakdown.baseCents,
          breakdown.taxCents,
        ]),
      ]) {
        expect(Number.isSafeInteger(monetaryValue)).toBe(true);
      }
    }
  });
});

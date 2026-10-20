import { describe, expect, it } from "vitest";

import {
  fingerprintOf,
  normalizeConcept,
  withOccurrences,
} from "@/lib/bank/fingerprint";
import {
  confidenceFor,
  type MatchCandidate,
  suggestAll,
  suggestFor,
} from "@/lib/bank/matching";

const base = {
  account: "2100-0001-0123456789",
  operationOn: "2026-03-02",
  valueOn: "2026-03-02",
  amountCents: 16_637,
  concept: "Transferencia de Talleres Martínez SL FRA F-2026-0001",
  reference: "1000",
};

describe("fingerprints", () => {
  it("are stable, and insensitive to case, accents and spacing in the concept", async () => {
    const first = await fingerprintOf(base);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(
      await fingerprintOf({
        ...base,
        concept: "TRANSFERENCIA  DE TALLERES MARTINEZ SL  FRA F-2026-0001",
      }),
    ).toBe(first);
  });

  it("change with any field", async () => {
    const first = await fingerprintOf(base);
    for (const change of [
      { amountCents: 16_638 },
      { operationOn: "2026-03-03" },
      { valueOn: null },
      { reference: "1001" },
      { account: "other" },
      { concept: "otro" },
    ]) {
      expect(await fingerprintOf({ ...base, ...change })).not.toBe(first);
    }
  });

  it("gives identical movements the same fingerprint and rising occurrences", async () => {
    const rows = await withOccurrences([
      base,
      base,
      { ...base, amountCents: 1 },
      base,
    ]);
    expect(rows.map((row) => row.occurrence)).toEqual([1, 2, 1, 3]);
    expect(rows[0]?.fingerprint).toBe(rows[1]?.fingerprint);
    expect(rows[0]?.fingerprint).not.toBe(rows[2]?.fingerprint);
    expect(normalizeConcept("  Pañales  y   más ")).toBe("PANALES Y MAS");
  });
});

const invoices: MatchCandidate[] = [
  {
    documentId: "inv-1",
    fullNumber: "F-2026-0001",
    clientName: "Talleres Martínez SL",
    clientTaxId: "B12345674",
    pendingCents: 16_637,
    dueDate: "2026-03-10",
  },
  {
    documentId: "inv-2",
    fullNumber: "F-2026-0002",
    clientName: "Estudio Gráfico Luna",
    clientTaxId: "B87654321",
    pendingCents: 28_737,
    dueDate: "2026-03-15",
  },
  {
    documentId: "inv-3",
    fullNumber: "F-2026-0003",
    clientName: "Panadería El Trigal",
    clientTaxId: null,
    pendingCents: 28_737,
    dueDate: "2026-06-30",
  },
];

const tx = (overrides: Partial<Parameters<typeof suggestFor>[0]>) => ({
  id: "tx",
  amountCents: 16_637,
  concept: "ABONO VARIOS",
  operationOn: "2026-03-02",
  ...overrides,
});

describe("match scoring", () => {
  it("scores invoice number, exact and unique amount, client and due proximity", () => {
    const [best] = suggestFor(
      tx({ concept: "TRANSFERENCIA DE TALLERES MARTÍNEZ SL FRA F-2026-0001" }),
      invoices,
    );
    expect(best).toMatchObject({
      documentId: "inv-1",
      score: 60 + 30 + 10 + 20 + 5,
      confidence: "high",
      allocationCents: 16_637,
    });
    expect(best?.reasons).toEqual([
      "invoice_number",
      "exact_amount",
      "unique_amount",
      "client",
      "due_date",
    ]);
  });

  it("the invoice number matches whatever the separators", () => {
    const [best] = suggestFor(tx({ concept: "PAGO FRA F20260001" }), invoices);
    expect(best?.reasons).toContain("invoice_number");
  });

  it("a unique exact amount alone is enough to suggest, with low confidence", () => {
    const [best] = suggestFor(
      tx({ concept: "INGRESO", operationOn: "2026-09-01" }),
      invoices,
    );
    expect(best).toMatchObject({
      documentId: "inv-1",
      score: 40,
      confidence: "low",
    });
  });

  it("an amount shared by two invoices is not unique, and the client breaks the tie", () => {
    const suggestions = suggestFor(
      tx({
        amountCents: 28_737,
        concept: "BIZUM DE PANADERIA EL TRIGAL",
        operationOn: "2026-09-01",
      }),
      invoices,
    );
    expect(suggestions.map((suggestion) => suggestion.documentId)).toEqual([
      "inv-3",
      "inv-2",
    ]);
    expect(suggestions[0]?.reasons).toEqual(["exact_amount", "client"]);
    expect(suggestions[1]?.reasons).toEqual(["exact_amount"]);
  });

  it("a partial payment is allocated up to the movement and pending amounts", () => {
    const [best] = suggestFor(
      tx({ amountCents: 5_000, concept: "ENTREGA A CUENTA F-2026-0002" }),
      invoices,
    );
    expect(best).toMatchObject({ documentId: "inv-2", allocationCents: 5_000 });
    const [rest] = suggestFor(
      tx({ amountCents: 40_000, concept: "F-2026-0001 Y OTROS" }),
      invoices,
    );
    expect(rest).toMatchObject({
      documentId: "inv-1",
      allocationCents: 16_637,
    });
  });

  it("discounts what is already allocated and ignores charges and fully allocated movements", () => {
    expect(
      suggestFor(
        tx({ amountCents: -16_637, concept: "F-2026-0001" }),
        invoices,
      ),
    ).toEqual([]);
    expect(
      suggestFor(
        tx({ allocatedCents: 16_637, concept: "F-2026-0001" }),
        invoices,
      ),
    ).toEqual([]);
    const [partly] = suggestFor(
      tx({
        amountCents: 20_000,
        allocatedCents: 3_363,
        concept: "F-2026-0001",
      }),
      invoices,
    );
    expect(partly?.allocationCents).toBe(16_637);
    expect(partly?.reasons).toContain("exact_amount");
  });

  it("ignores invoices with nothing pending and weak matches", () => {
    expect(
      suggestFor(tx({ concept: "F-2026-0001" }), [
        { ...invoices[0], pendingCents: 0 } as MatchCandidate,
      ]),
    ).toEqual([]);
    expect(
      suggestFor(
        tx({ amountCents: 99, concept: "NADA", operationOn: "2027-01-01" }),
        invoices,
      ),
    ).toEqual([]);
  });

  it("does not propose one invoice for two movements", () => {
    const result = suggestAll(
      [
        tx({ id: "a", concept: "F-2026-0001" }),
        tx({ id: "b", concept: "INGRESO", operationOn: "2026-09-01" }),
      ],
      invoices,
    );
    expect(
      result.map((suggestion) => [
        suggestion.transactionId,
        suggestion.documentId,
      ]),
    ).toEqual([["a", "inv-1"]]);
  });

  it("buckets confidence", () => {
    expect([
      confidenceFor(100),
      confidenceFor(80),
      confidenceFor(79),
      confidenceFor(50),
      confidenceFor(49),
    ]).toEqual(["high", "high", "medium", "medium", "low"]);
  });
});

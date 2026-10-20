import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  missingBankFields,
  parseBankAmount,
  parseBankDate,
  readCsvStatement,
  suggestBankMapping,
} from "@/lib/bank/csv-statement";
import { decodeCsvBytes } from "@/lib/csv/decode";
import { parseCsv } from "@/lib/csv/detect";

describe("bank CSV statements", () => {
  it("suggests the mapping, keeping «Fecha valor» apart from «Fecha»", () => {
    expect(
      suggestBankMapping([
        "Fecha",
        "Fecha valor",
        "Concepto",
        "Importe",
        "Saldo",
      ]),
    ).toEqual({
      operation_date: 0,
      value_date: 1,
      concept: 2,
      amount: 3,
      balance: 4,
    });
    expect(missingBankFields(suggestBankMapping(["Nombre", "Notas"]))).toEqual([
      "operation_date",
      "concept",
      "amount",
    ]);
  });

  it.each([
    ["02/04/2026", "2026-04-02"],
    ["2/4/26", "2026-04-02"],
    ["2026-04-02", "2026-04-02"],
    ["31-12-2026", "2026-12-31"],
  ])("date %s", (raw, expected) => {
    expect(parseBankDate(raw)).toBe(expected);
  });

  it.each(["31/02/2026", "ayer", "2026/04/02", ""])(
    "rejects date %j",
    (raw) => {
      expect(() => parseBankDate(raw)).toThrow();
    },
  );

  it.each([
    ["287,37", 28_737],
    ["-650,00", -65_000],
    ["1.287,37", 128_737],
    ["-1.234,5", -123_450],
    ["12.5", 1_250],
    ["(45,00)", -4_500],
    ["+0,12 €", 12],
  ])("amount %s", (raw, expected) => {
    expect(parseBankAmount(raw)).toBe(expected);
  });

  it("rejects amounts with more than two decimals", () => {
    expect(() => parseBankAmount("1,234")).toThrow();
    expect(() => parseBankAmount("abc")).toThrow();
  });

  it("reads the fixture with the closing balance of the last day", async () => {
    const text = decodeCsvBytes(
      new Uint8Array(await readFile("tests/fixtures/bank/statement.csv")),
    ).text;
    const { headers, rows } = parseCsv(text);
    const statement = readCsvStatement(rows, suggestBankMapping(headers));
    expect(statement.errors).toEqual([]);
    expect(statement.movements).toHaveLength(8);
    expect(statement.movements[1]).toMatchObject({
      operationOn: "2026-04-03",
      amountCents: -65_000,
      concept: "RECIBO ALQUILER LOCAL",
    });
    expect(statement).toMatchObject({
      closingBalanceCents: 111_975,
      closingBalanceOn: "2026-04-30",
      periodStart: "2026-04-02",
      periodEnd: "2026-04-30",
    });
  });

  it("reports every bad row with its line and keeps the good ones", () => {
    const statement = readCsvStatement(
      [
        ["01/05/2026", "", "OK", "10,00", ""],
        ["32/05/2026", "", "Mala fecha", "10,00", ""],
        ["02/05/2026", "", "", "x", ""],
      ],
      { operation_date: 0, value_date: 1, concept: 2, amount: 3, balance: 4 },
    );
    expect(statement.movements).toHaveLength(1);
    expect(statement.errors.map((error) => [error.line, error.field])).toEqual([
      [3, "operation_date"],
      [4, "amount"],
      [4, "concept"],
    ]);
  });
});

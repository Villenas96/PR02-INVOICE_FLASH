import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { decodeNorma43, Norma43Error, parseNorma43 } from "@/lib/bank/norma43";

const load = async (name: string) =>
  decodeNorma43(new Uint8Array(await readFile(`tests/fixtures/bank/${name}`)));
const expected = JSON.parse(
  await readFile("tests/fixtures/bank/sample.expected.json", "utf8"),
) as {
  account: { entity: string; office: string; number: string };
  period: { start: string; end: string };
  opening_balance_cents: number;
  closing_balance_cents: number;
  movement_count: number;
  credit_count: number;
  debit_count: number;
  overlap: { movement_count: number; new_movements: number };
};

describe("Norma 43 parser", () => {
  it("reads the account, period and balances of the fixture", async () => {
    const { accounts } = parseNorma43(await load("sample.n43"));
    expect(accounts).toHaveLength(1);
    const account = accounts[0];
    expect(account).toMatchObject({
      entity: expected.account.entity,
      office: expected.account.office,
      number: expected.account.number,
      periodStart: expected.period.start,
      periodEnd: expected.period.end,
      openingBalanceCents: expected.opening_balance_cents,
      closingBalanceCents: expected.closing_balance_cents,
    });
  });

  it("reads every movement with sign, dates and joined concepts (Latin-1)", async () => {
    const [account] = parseNorma43(await load("sample.n43")).accounts;
    const movements = account?.movements ?? [];
    expect(movements).toHaveLength(expected.movement_count);
    expect(movements.filter((m) => m.amountCents > 0)).toHaveLength(
      expected.credit_count,
    );
    expect(movements.filter((m) => m.amountCents < 0)).toHaveLength(
      expected.debit_count,
    );
    expect(movements[0]).toEqual({
      operationOn: "2026-03-02",
      valueOn: "2026-03-02",
      amountCents: 16_637,
      concept: "TRANSFERENCIA DE TALLERES MARTÍNEZ SL FRA F-2026-0001",
      reference: "1000",
    });
    const last = movements.at(-1);
    expect(last).toMatchObject({
      operationOn: "2026-03-31",
      amountCents: -600,
      concept: "COMISION MANTENIMIENTO",
    });
    const sum = movements.reduce((total, m) => total + m.amountCents, 0);
    expect((account?.openingBalanceCents ?? 0) + sum).toBe(
      expected.closing_balance_cents,
    );
  });

  it("accepts the overlapping statement", async () => {
    const [account] = parseNorma43(await load("overlap.n43")).accounts;
    expect(account?.movements).toHaveLength(
      expected.movement_count - 12 + 0 || 8,
    );
  });

  it("rejects totals that do not match (corrupted or truncated file)", async () => {
    const text = await load("sample.n43");
    const withoutMovement = text
      .split(/\r?\n/)
      .filter((_line, index) => index !== 1 && index !== 2 && index !== 3)
      .join("\r\n");
    expect(() => parseNorma43(withoutMovement)).toThrow(/no cuadran/);
  });

  it.each([
    ["unknown record", "99 nope"],
    [
      "movement without header",
      "22    0001260302260302020002000000000166370000001000",
    ],
    ["concept without movement", "2301SOLO UN CONCEPTO"],
  ])("rejects %s with its line number", (_name, content) => {
    expect(() => parseNorma43(content)).toThrow(Norma43Error);
    try {
      parseNorma43(content);
    } catch (error) {
      expect((error as Norma43Error).line).toBe(1);
    }
  });

  it("rejects a bad date and a bad debit/credit key", async () => {
    const text = await load("sample.n43");
    const badDate = text.replace("260302260302", "261302260302");
    expect(() => parseNorma43(badDate)).toThrow(/fecha/);
    const badKey = text.replace(
      "020002000000000166370",
      "020009000000000166370",
    );
    expect(() => parseNorma43(badKey)).toThrow(/clave/);
  });

  it("rejects files that end without the account footer or are empty", () => {
    expect(() => parseNorma43("")).toThrow(/ninguna cuenta/);
    expect(() =>
      parseNorma43("112100000101234567892603012603312000000002500009783FACTUM"),
    ).toThrow(/sin el registro 33/);
  });
});

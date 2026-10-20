import { describe, expect, it } from "vitest";

import { createDatabase } from "@/db";
import { createCollectionMethod } from "@/services/collection-methods";
import { loadCompanySummary } from "@/services/company-summary";
import { ensureDefaultSeries } from "@/services/series";
import {
  ensureTaxRates,
  listActiveTaxRates,
  setDefaultIvaRate,
} from "@/services/tax-rates";
import { createUnit, listUnits } from "@/services/units";

import { createIntegrationDatabase } from "./database";
import { createOwner } from "./fixtures";

/**
 * Production talks to Postgres through neon-http, which sends every
 * parameter as text (booleans included) and has no interactive
 * transactions. Most integration tests use postgres-js; this suite runs the
 * raw-SQL services through the real neon-http driver (via the local proxy).
 */
describe("raw SQL services over the neon-http driver", () => {
  it("seeds and switches tax types, series, units and methods", async () => {
    const owner = await createOwner(createIntegrationDatabase());
    const database = createDatabase();

    await ensureTaxRates(database, owner.companyId);
    await setDefaultIvaRate(database, owner.companyId, "10.00");
    const rates = await listActiveTaxRates(database, owner.companyId);
    expect(rates.filter((rate) => rate.isDefault)).toEqual([
      expect.objectContaining({ rate: "10.00" }),
    ]);
    expect(
      await ensureDefaultSeries(database, owner.companyId, "proforma"),
    ).toMatchObject({ created: true });
    await createUnit(database, owner.companyId, "Palé");
    expect((await listUnits(database, owner.companyId)).custom).toHaveLength(1);
    const method = await createCollectionMethod(database, owner.companyId, {
      kind: "cash",
      label: "Efectivo",
      holder_name: null,
      iban: null,
      bic: null,
      phone: null,
      email_or_url: null,
      instructions: null,
    });
    expect(method.isDefault).toBe(true);
    expect(
      (await loadCompanySummary(database, owner.companyId))?.defaultTaxRate,
    ).toBe("10.00");
  });
});

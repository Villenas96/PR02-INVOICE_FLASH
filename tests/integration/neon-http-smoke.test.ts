import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDatabase } from "@/db";
import { documents, exportJobs } from "@/db/schema";
import { createCollectionMethod } from "@/services/collection-methods";
import { loadCompanySummary } from "@/services/company-summary";
import { buildExport } from "@/services/exports";
import { ensureDefaultSeries } from "@/services/series";
import {
  ensureTaxRates,
  listActiveTaxRates,
  setDefaultIvaRate,
} from "@/services/tax-rates";
import { createUnit, listUnits } from "@/services/units";

import { InMemoryBucket } from "./bucket";
import { createIntegrationDatabase } from "./database";
import { createOwner, recordingQueue } from "./fixtures";

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

  it("builds an export and stores its file list", async () => {
    const owner = await createOwner(createIntegrationDatabase(), {
      plan: "pro",
    });
    const database = createDatabase();
    await database.insert(documents).values({
      id: crypto.randomUUID(),
      companyId: owner.companyId,
      documentType: "invoice",
      status: "issued",
      number: 1,
      fullNumber: "2026-0001",
      issueDate: "2026-08-01",
      totalCents: 1_210,
      pdfStatus: "ready",
    });
    const [job] = await database
      .insert(exportJobs)
      .values({
        id: crypto.randomUUID(),
        companyId: owner.companyId,
        requestedBy: `user:${owner.userId}`,
        kind: "advanced",
        filters: { types: ["invoice"], from: "2026-07-01", to: "2026-09-30" },
        formats: ["xlsx"],
      })
      .returning();
    // text[] must round-trip (Neon sends Postgres array text).
    expect(job?.formats).toEqual(["xlsx"]);
    await buildExport(job?.id as string, {
      database,
      bucket: new InMemoryBucket(),
      pdfQueue: recordingQueue(),
      emailQueue: recordingQueue(),
      secret: "neon-http-secret-at-least-thirty-two-chars!",
    });
    const [stored] = await database
      .select({ status: exportJobs.status, fileKeys: exportJobs.fileKeys })
      .from(exportJobs)
      .where(eq(exportJobs.id, job?.id as string));
    expect(stored?.status).toBe("ready");
    expect(stored?.fileKeys).toEqual([
      expect.objectContaining({ filename: expect.stringMatching(/\.xlsx$/) }),
    ]);
  });
});

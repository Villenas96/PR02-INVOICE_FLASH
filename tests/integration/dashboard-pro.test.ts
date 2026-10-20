import { describe, expect, it, vi } from "vitest";

import {
  bankStatements,
  clients,
  collectionMethods,
  documents,
  payments,
} from "@/db/schema";
import {
  invoicedFigures,
  monthlySeries,
  topClients,
  treasury,
} from "@/services/dashboard";

import { createIntegrationDatabase } from "./database";
import { createOwner, type OwnerFixture } from "./fixtures";
import { APP_BASE_URL, authenticatedRequest, createTenant } from "./http";

process.env.BETTER_AUTH_SECRET =
  "invoice-flash-contract-secret-at-least-thirty-two-characters";
process.env.BETTER_AUTH_URL = APP_BASE_URL;

const database = createIntegrationDatabase();
vi.mock("@/db", () => ({ createDatabase: () => database }));
vi.mock("@/db/index", () => ({ createDatabase: () => database }));

const { auth, setAuthEmailDeliveryHandler } = await import("@/lib/auth");
const routes = {
  base: (await import("@/app/api/v1/dashboard/route")).GET,
  monthly: (await import("@/app/api/v1/dashboard/monthly/route")).GET,
  topClients: (await import("@/app/api/v1/dashboard/top-clients/route")).GET,
  treasury: (await import("@/app/api/v1/dashboard/treasury/route")).GET,
};

const TODAY = "2026-10-20";

interface SeedInvoice {
  month: string; // YYYY-MM of issue
  day: string;
  clientIndex: number;
  baseCents: number;
  taxes: Array<{
    name: string;
    rate: string;
    baseCents: number;
    taxCents: number;
  }>;
  paid: Array<{ on: string; cents: number }>;
  due: string;
  status?: "issued" | "voided";
  type?: "invoice" | "proforma";
}

function invoice(
  month: string,
  clientIndex: number,
  baseCents: number,
  rate: string,
  paid: SeedInvoice["paid"],
  due: string,
  extra: Partial<SeedInvoice> = {},
): SeedInvoice {
  const taxCents = Math.round((baseCents * Number(rate)) / 100);
  return {
    month,
    day: `${month}-10`,
    clientIndex,
    baseCents,
    taxes: [{ name: "IVA", rate, baseCents, taxCents }],
    paid,
    due,
    ...extra,
  };
}

const SEED: SeedInvoice[] = [
  invoice(
    "2025-11",
    0,
    100_000,
    "21.00",
    [{ on: "2025-12-01", cents: 121_000 }],
    "2025-12-10",
  ),
  invoice(
    "2025-12",
    1,
    50_000,
    "10.00",
    [{ on: "2026-01-05", cents: 55_000 }],
    "2026-01-10",
  ),
  invoice(
    "2026-01",
    0,
    80_000,
    "21.00",
    [{ on: "2026-01-20", cents: 50_000 }],
    "2026-02-10",
  ),
  invoice("2026-02", 2, 20_000, "4.00", [], "2026-03-10"),
  invoice(
    "2026-03",
    1,
    300_000,
    "21.00",
    [{ on: "2026-04-02", cents: 363_000 }],
    "2026-04-10",
  ),
  invoice("2026-04", 0, 10_000, "21.00", [], "2026-05-10"),
  invoice(
    "2026-05",
    2,
    40_000,
    "21.00",
    [{ on: "2026-05-30", cents: 48_400 }],
    "2026-06-10",
  ),
  invoice("2026-06", 3, 60_000, "10.00", [], "2026-07-10"),
  invoice(
    "2026-07",
    3,
    70_000,
    "21.00",
    [{ on: "2026-08-15", cents: 40_000 }],
    "2026-08-10",
  ),
  invoice("2026-08", 1, 90_000, "21.00", [], "2026-10-25"),
  invoice("2026-09", 0, 110_000, "21.00", [], "2026-11-12"),
  invoice(
    "2026-10",
    2,
    30_000,
    "10.00",
    [{ on: "2026-10-12", cents: 33_000 }],
    "2026-11-05",
  ),
  // Never counted: voided, proforma, older than the 12-month window's start.
  invoice("2026-05", 0, 999_000, "21.00", [], "2026-06-10", {
    status: "voided",
  }),
  invoice("2026-06", 0, 777_000, "21.00", [], "2026-07-10", {
    type: "proforma",
  }),
];

const CLIENT_NAMES = ["Alfa, S.L.", "Beta, S.A.", "Gamma Sur", "Delta Norte"];

async function seed(owner: OwnerFixture) {
  const clientIds: string[] = [];
  for (const name of CLIENT_NAMES) {
    const id = crypto.randomUUID();
    clientIds.push(id);
    await database.insert(clients).values({
      id,
      companyId: owner.companyId,
      name,
      taxId: "B12345678",
    });
  }
  for (const [index, item] of SEED.entries()) {
    const id = crypto.randomUUID();
    const taxTotal = item.taxes.reduce((sum, tax) => sum + tax.taxCents, 0);
    await database.insert(documents).values({
      id,
      companyId: owner.companyId,
      documentType: item.type ?? "invoice",
      status: item.status ?? "issued",
      number: index + 1,
      fullNumber: `D-${String(index + 1).padStart(4, "0")}`,
      clientId: clientIds[item.clientIndex],
      issueDate: item.day,
      dueDate: item.due,
      subtotalCents: item.baseCents,
      taxBreakdown: item.taxes,
      totalCents: item.baseCents + taxTotal,
      pdfStatus: "ready",
    });
    for (const payment of item.paid) {
      await database.insert(payments).values({
        id: crypto.randomUUID(),
        companyId: owner.companyId,
        documentId: id,
        amountCents: payment.cents,
        paidOn: payment.on,
      });
    }
  }
  const [method] = await database
    .insert(collectionMethods)
    .values({
      id: crypto.randomUUID(),
      companyId: owner.companyId,
      kind: "bank_account",
      label: "Cuenta",
    })
    .returning({ id: collectionMethods.id });
  for (const [on, cents] of [
    ["2026-09-30", 500_000],
    ["2026-10-15", 742_150],
  ] as const) {
    await database.insert(bankStatements).values({
      id: crypto.randomUUID(),
      companyId: owner.companyId,
      collectionMethodId: method?.id as string,
      format: "norma43",
      fileKey: "x",
      closingBalanceCents: cents,
      closingBalanceOn: on,
    });
  }
}

/** Control figures from the raw seed, independent from the SQL under test. */
function control() {
  const counted = SEED.filter(
    (item) =>
      (item.type ?? "invoice") === "invoice" &&
      (item.status ?? "issued") === "issued",
  );
  const total = (item: SeedInvoice) =>
    item.baseCents + item.taxes.reduce((sum, tax) => sum + tax.taxCents, 0);
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 9 - index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }).reverse();
  return {
    counted,
    total,
    months,
    monthly: months.map((month) => ({
      month,
      invoicedCents: counted
        .filter((item) => item.month === month)
        .reduce((sum, item) => sum + total(item), 0),
      collectedCents: counted
        .flatMap((item) => item.paid)
        .filter((payment) => payment.on.startsWith(month))
        .reduce((sum, payment) => sum + payment.cents, 0),
    })),
  };
}

describe("Pro dashboard figures (SC-013)", () => {
  it("monthly series matches the control query, excluding voided and proformas", async () => {
    const owner = await createOwner(database, { plan: "pro" });
    await seed(owner);
    const expected = control();
    expect(await monthlySeries(owner.companyId, TODAY, 12, database)).toEqual(
      expected.monthly,
    );
  });

  it("invoiced totals and tax by name/rate match, for the whole range and a custom period", async () => {
    const owner = await createOwner(database, { plan: "pro" });
    await seed(owner);
    const { counted, total } = control();

    const all = await invoicedFigures(owner.companyId, {}, database);
    expect(all.invoicedBaseCents).toBe(
      counted.reduce((sum, i) => sum + i.baseCents, 0),
    );
    expect(all.invoicedTotalCents).toBe(
      counted.reduce((sum, i) => sum + total(i), 0),
    );
    expect(all.invoiceCount).toBe(counted.length);
    const byRate = new Map<string, { base: number; tax: number }>();
    for (const item of counted) {
      for (const tax of item.taxes) {
        const entry = byRate.get(tax.rate) ?? { base: 0, tax: 0 };
        entry.base += tax.baseCents;
        entry.tax += tax.taxCents;
        byRate.set(tax.rate, entry);
      }
    }
    expect(all.taxCollected).toEqual(
      [...byRate.entries()]
        .sort(([left], [right]) => Number(right) - Number(left))
        .map(([rate, entry]) => ({
          name: "IVA",
          rate,
          baseCents: entry.base,
          taxCents: entry.tax,
        })),
    );

    const period = { from: "2026-03-01", to: "2026-06-30" };
    const inPeriod = counted.filter(
      (i) => i.day >= period.from && i.day <= period.to,
    );
    const partial = await invoicedFigures(owner.companyId, period, database);
    expect(partial.invoicedTotalCents).toBe(
      inPeriod.reduce((sum, i) => sum + total(i), 0),
    );
    expect(partial.invoiceCount).toBe(inPeriod.length);
  });

  it("top 5 clients by invoiced total", async () => {
    const owner = await createOwner(database, { plan: "pro" });
    await seed(owner);
    const { counted, total } = control();
    const byClient = new Map<number, number>();
    for (const item of counted) {
      byClient.set(
        item.clientIndex,
        (byClient.get(item.clientIndex) ?? 0) + total(item),
      );
    }
    const wanted = [...byClient.entries()]
      .sort(([, left], [, right]) => right - left)
      .map(([index, cents]) => ({
        name: CLIENT_NAMES[index],
        invoicedCents: cents,
      }));
    const result = await topClients(owner.companyId, {}, 5, database);
    expect(
      result.map(({ name, invoicedCents }) => ({ name, invoicedCents })),
    ).toEqual(wanted);
    expect(result).toHaveLength(4);
    expect(
      (await topClients(owner.companyId, {}, 2, database)).map(
        (client) => client.name,
      ),
    ).toEqual(wanted.slice(0, 2).map((client) => client.name));
  });

  it("treasury: latest balance, expected collections at 30 days and overdue", async () => {
    const owner = await createOwner(database, { plan: "pro" });
    await seed(owner);
    const { counted, total } = control();
    const outstanding = (item: SeedInvoice) =>
      total(item) - item.paid.reduce((sum, p) => sum + p.cents, 0);
    const pending = counted.filter((item) => outstanding(item) > 0);
    const figures = await treasury(owner.companyId, TODAY, database);
    expect(figures.balanceCents).toBe(742_150);
    expect(figures.balanceOn).toBe("2026-10-15");
    expect(figures.expected30DaysCents).toBe(
      pending
        .filter((item) => item.due >= TODAY && item.due <= "2026-11-19")
        .reduce((sum, item) => sum + outstanding(item), 0),
    );
    expect(figures.overdueCents).toBe(
      pending
        .filter((item) => item.due < TODAY)
        .reduce((sum, item) => sum + outstanding(item), 0),
    );
  });

  it("a company without a statement has no balance", async () => {
    const owner = await createOwner(database, { plan: "pro" });
    expect(await treasury(owner.companyId, TODAY, database)).toEqual({
      balanceCents: null,
      balanceOn: null,
      expected30DaysCents: 0,
      overdueCents: 0,
    });
  });

  it("never mixes in another company's figures", async () => {
    const mine = await createOwner(database, { plan: "pro" });
    const other = await createOwner(database, { plan: "pro" });
    await seed(other);
    expect(
      (await invoicedFigures(mine.companyId, {}, database)).invoiceCount,
    ).toBe(0);
    expect(await topClients(mine.companyId, {}, 5, database)).toEqual([]);
    expect(
      (await monthlySeries(mine.companyId, TODAY, 12, database)).every(
        (point) => point.invoicedCents === 0 && point.collectedCents === 0,
      ),
    ).toBe(true);
  });
});

describe("dashboard endpoints by plan", () => {
  it.each(["basic", "essential"] as const)(
    "%s: full endpoints 403, base has no Pro fields",
    async (plan) => {
      setAuthEmailDeliveryHandler(() => Promise.resolve());
      const tenant = await createTenant(auth, database, plan);
      for (const [name, handler] of Object.entries({
        monthly: routes.monthly,
        topClients: routes.topClients,
        treasury: routes.treasury,
      })) {
        const response = await handler(
          authenticatedRequest(tenant, `/api/v1/dashboard/${name}`),
        );
        expect(response.status, name).toBe(403);
        expect(await response.json()).toMatchObject({
          error: {
            code: "feature_not_in_plan",
            details: { feature: "dashboard_full" },
          },
        });
      }
      const base = await routes.base(
        authenticatedRequest(tenant, "/api/v1/dashboard"),
      );
      expect(base.status).toBe(200);
      const body = (await base.json()) as Record<string, unknown>;
      expect(body).toHaveProperty("paid_cents");
      expect(body).not.toHaveProperty("invoiced_total_cents");
      expect(body).not.toHaveProperty("tax_collected");
    },
  );

  it("pro: every endpoint answers", async () => {
    setAuthEmailDeliveryHandler(() => Promise.resolve());
    const tenant = await createTenant(auth, database, "pro");
    const base = await routes.base(
      authenticatedRequest(tenant, "/api/v1/dashboard"),
    );
    expect(await base.json()).toMatchObject({
      invoiced_total_cents: 0,
      tax_collected: [],
    });
    const monthly = await routes.monthly(
      authenticatedRequest(tenant, "/api/v1/dashboard/monthly"),
    );
    expect(((await monthly.json()) as { items: unknown[] }).items).toHaveLength(
      12,
    );
    expect(
      (
        await routes.topClients(
          authenticatedRequest(tenant, "/api/v1/dashboard/top-clients"),
        )
      ).status,
    ).toBe(200);
    expect(
      await (
        await routes.treasury(
          authenticatedRequest(tenant, "/api/v1/dashboard/treasury"),
        )
      ).json(),
    ).toMatchObject({ balance_cents: null, expected_30_days_cents: 0 });
  });
});

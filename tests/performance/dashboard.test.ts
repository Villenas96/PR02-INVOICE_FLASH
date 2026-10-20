import { describe, it } from "vitest";

import { clients, companies, documents, payments, users } from "@/db/schema";
import {
  invoicedFigures,
  monthlySeries,
  topClients,
  treasury,
} from "@/services/dashboard";

import {
  createIntegrationDatabase,
  truncateIntegrationDatabase,
} from "../integration/database";
import { expectP95Below } from "./report";

const database = createIntegrationDatabase();
const P95_MS = 500;
const ITERATIONS = 20;
const CLIENTS = 200;
const INVOICES_PER_MONTH = 400;
const TODAY = "2026-10-20";
const BATCH = 500;

describe("Pro dashboard performance (SC-013)", () => {
  it(`answers the four aggregates in under ${P95_MS}ms p95 with 12 months of data`, async () => {
    await truncateIntegrationDatabase();
    const now = new Date();
    const userId = crypto.randomUUID();
    const companyId = crypto.randomUUID();
    await database.insert(users).values({
      id: userId,
      name: "Rendimiento",
      email: `perf-${crypto.randomUUID()}@example.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(companies).values({
      id: companyId,
      userId,
      legalName: "Empresa Rendimiento, S.L.",
      email: "perf@example.test",
      plan: "pro",
    });
    const clientIds = Array.from({ length: CLIENTS }, () =>
      crypto.randomUUID(),
    );
    await database.insert(clients).values(
      clientIds.map((id, index) => ({
        id,
        companyId,
        name: `Cliente ${index}`,
        taxId: `B${String(10_000_000 + index)}`,
      })),
    );

    const invoiceRows: Array<typeof documents.$inferInsert> = [];
    const paymentRows: Array<typeof payments.$inferInsert> = [];
    let number = 0;
    for (let month = 0; month < 12; month += 1) {
      const date = new Date(Date.UTC(2025, 10 + month, 1));
      const iso = date.toISOString().slice(0, 7);
      for (let index = 0; index < INVOICES_PER_MONTH; index += 1) {
        number += 1;
        const id = crypto.randomUUID();
        const base = 10_000 + ((number * 137) % 90_000);
        const tax = Math.round(base * 0.21);
        invoiceRows.push({
          id,
          companyId,
          documentType: "invoice",
          status: "issued",
          number,
          fullNumber: `P-${number}`,
          clientId: clientIds[number % CLIENTS],
          issueDate: `${iso}-${String((index % 27) + 1).padStart(2, "0")}`,
          dueDate: `${iso}-28`,
          subtotalCents: base,
          taxBreakdown: [
            { name: "IVA", rate: "21.00", baseCents: base, taxCents: tax },
          ],
          totalCents: base + tax,
          pdfStatus: "ready",
        });
        if (number % 3 !== 0) {
          paymentRows.push({
            id: crypto.randomUUID(),
            companyId,
            documentId: id,
            amountCents: base + tax,
            paidOn: `${iso}-28`,
          });
        }
      }
    }
    for (let offset = 0; offset < invoiceRows.length; offset += BATCH) {
      await database
        .insert(documents)
        .values(invoiceRows.slice(offset, offset + BATCH));
    }
    for (let offset = 0; offset < paymentRows.length; offset += BATCH) {
      await database
        .insert(payments)
        .values(paymentRows.slice(offset, offset + BATCH));
    }

    const durations: number[] = [];
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const startedAt = performance.now();
      await Promise.all([
        invoicedFigures(companyId, {}, database),
        monthlySeries(companyId, TODAY, 12, database),
        topClients(companyId, {}, 5, database),
        treasury(companyId, TODAY, database),
      ]);
      durations.push(performance.now() - startedAt);
    }
    expectP95Below(durations, P95_MS);
  }, 120_000);
});

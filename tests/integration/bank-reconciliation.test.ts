import { readFile } from "node:fs/promises";

import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  bankStatements,
  bankTransactions,
  clients,
  collectionMethods,
  documentEvents,
  documents,
  payments,
  reconciliations,
} from "@/db/schema";
import { toApiError } from "@/lib/api/errors";
import { confirmBankImport, createBankImport } from "@/services/bank/import";
import {
  createReconciliation,
  deleteReconciliation,
  listBankTransactions,
  reconciliationSuggestions,
  setTransactionIgnored,
} from "@/services/bank/reconciliation";
import type { CompanyContext } from "@/services/context";
import { analyzeImport, applyImport, getImport } from "@/services/imports";

import { InMemoryBucket } from "./bucket";
import { createIntegrationDatabase } from "./database";
import { createOwner, type OwnerFixture, recordingQueue } from "./fixtures";

const database = createIntegrationDatabase();
// Entity 2100, office 0001, account 0123456789 (the fixture's account).
const IBAN = "ES0021000001000123456789";

interface Expected {
  movement_count: number;
  closing_balance_cents: number;
  credit_count: number;
  debit_count: number;
  overlap: { movement_count: number; new_movements: number };
  invoices: Array<{
    invoice: string;
    client: string;
    tax_id: string;
    total_cents: number;
    allocation_cents: number;
  }>;
}
const expected = JSON.parse(
  await readFile("tests/fixtures/bank/sample.expected.json", "utf8"),
) as Expected;

function contextOf(
  owner: OwnerFixture,
  plan: "pro" | "basic" = "pro",
): CompanyContext {
  return {
    userId: owner.userId,
    companyId: owner.companyId,
    role: "owner",
    plan,
  };
}

async function setup() {
  const owner = await createOwner(database, { plan: "pro" });
  const [method] = await database
    .insert(collectionMethods)
    .values({
      id: crypto.randomUUID(),
      companyId: owner.companyId,
      kind: "bank_account",
      label: "Cuenta principal",
      iban: IBAN,
    })
    .returning({ id: collectionMethods.id });
  return {
    owner,
    methodId: method?.id as string,
    bucket: new InMemoryBucket(),
  };
}

async function importFile(
  s: Awaited<ReturnType<typeof setup>>,
  name: string,
): Promise<{ id: string; preview: Record<string, unknown> }> {
  const jobs = recordingQueue();
  const file = new File(
    [new Uint8Array(await readFile(`tests/fixtures/bank/${name}`))],
    name,
  );
  const created = await createBankImport({
    database,
    bucket: s.bucket,
    queue: jobs,
    companyId: s.owner.companyId,
    plan: "pro",
    file,
    collectionMethodId: s.methodId,
  });
  await analyzeImport(created.id, { database, bucket: s.bucket });
  const job = await getImport(database, s.owner.companyId, created.id);
  return {
    id: created.id,
    preview: (job.preview ?? {}) as Record<string, unknown>,
  };
}

async function confirmAndApply(
  s: Awaited<ReturnType<typeof setup>>,
  importId: string,
  mapping?: Parameters<typeof confirmBankImport>[0]["mapping"],
) {
  const job = await getImport(database, s.owner.companyId, importId);
  await confirmBankImport({
    database,
    queue: recordingQueue(),
    companyId: s.owner.companyId,
    plan: "pro",
    job,
    mapping,
  });
  await applyImport(importId, { database, bucket: s.bucket });
  return getImport(database, s.owner.companyId, importId);
}

async function seedInvoices(owner: OwnerFixture) {
  const ids = new Map<string, string>();
  for (const [index, item] of expected.invoices.entries()) {
    const clientId = crypto.randomUUID();
    await database.insert(clients).values({
      id: clientId,
      companyId: owner.companyId,
      name: item.client,
      taxId: item.tax_id,
    });
    const id = crypto.randomUUID();
    ids.set(item.invoice, id);
    await database.insert(documents).values({
      id,
      companyId: owner.companyId,
      documentType: "invoice",
      status: "issued",
      number: index + 1,
      fullNumber: item.invoice,
      clientId,
      issueDate: "2026-02-20",
      dueDate: "2026-03-15",
      subtotalCents: item.total_cents,
      totalCents: item.total_cents,
      pdfStatus: "ready",
    });
  }
  return ids;
}

async function paidOf(documentId: string): Promise<number> {
  const rows = await database
    .select({ amount: payments.amountCents })
    .from(payments)
    .where(eq(payments.documentId, documentId));
  return rows.reduce((sum, row) => sum + row.amount, 0);
}

async function rawTransaction(
  s: Awaited<ReturnType<typeof setup>>,
  amountCents: number,
  concept = "INGRESO",
) {
  const statementId = crypto.randomUUID();
  await database
    .insert(bankStatements)
    .values({
      id: statementId,
      companyId: s.owner.companyId,
      collectionMethodId: s.methodId,
      format: "csv",
      fileKey: "x",
    })
    .onConflictDoNothing();
  const id = crypto.randomUUID();
  await database.insert(bankTransactions).values({
    id,
    companyId: s.owner.companyId,
    collectionMethodId: s.methodId,
    statementId,
    operationOn: "2026-03-10",
    amountCents,
    concept,
    fingerprint: crypto.randomUUID(),
    occurrence: 1,
  });
  return id;
}

async function invoiceFor(
  owner: OwnerFixture,
  number: string,
  totalCents: number,
) {
  const id = crypto.randomUUID();
  await database.insert(documents).values({
    id,
    companyId: owner.companyId,
    documentType: "invoice",
    status: "issued",
    number: Number(number.replace(/\D/g, "")) || 1,
    fullNumber: number,
    clientId: owner.clientId,
    issueDate: "2026-03-01",
    totalCents,
    subtotalCents: totalCents,
    pdfStatus: "ready",
  });
  return id;
}

describe("bank statement import", () => {
  it("previews without storing anything, then imports the 20 movements", async () => {
    const s = await setup();
    const { id, preview } = await importFile(s, "sample.n43");
    expect(preview).toMatchObject({
      format: "norma43",
      closing_balance_cents: expected.closing_balance_cents,
      summary: {
        movements: expected.movement_count,
        credits: expected.credit_count,
        debits: expected.debit_count,
        new_movements: expected.movement_count,
        duplicates: 0,
      },
    });
    expect(await database.select().from(bankTransactions)).toEqual([]);

    const job = await confirmAndApply(s, id);
    expect(job.status).toBe("done");
    expect(job.result).toEqual({ created: 20, duplicates: 0 });
    const [statement] = await database.select().from(bankStatements);
    expect(statement).toMatchObject({
      closingBalanceCents: expected.closing_balance_cents,
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
    });
    const stored = await database
      .select({ id: bankTransactions.id })
      .from(bankTransactions)
      .where(eq(bankTransactions.companyId, s.owner.companyId));
    expect(stored).toHaveLength(20);
  });

  it("re-importing the same file or an overlapping one adds nothing twice", async () => {
    const s = await setup();
    await confirmAndApply(s, (await importFile(s, "sample.n43")).id);

    const again = await importFile(s, "sample.n43");
    expect(again.preview).toMatchObject({
      summary: { new_movements: 0, duplicates: 20 },
    });
    expect((await confirmAndApply(s, again.id)).result).toEqual({
      created: 0,
      duplicates: 20,
    });

    const overlap = await importFile(s, "overlap.n43");
    expect(overlap.preview).toMatchObject({
      summary: {
        movements: expected.overlap.movement_count,
        new_movements: expected.overlap.new_movements,
      },
    });
    await confirmAndApply(s, overlap.id);
    const total = await database
      .select({ id: bankTransactions.id })
      .from(bankTransactions)
      .where(eq(bankTransactions.companyId, s.owner.companyId));
    expect(total).toHaveLength(20 + expected.overlap.new_movements);
  });

  it("re-delivering the apply job is safe", async () => {
    const s = await setup();
    const { id } = await importFile(s, "sample.n43");
    const job = await confirmAndApply(s, id);
    await applyImport(id, { database, bucket: s.bucket });
    expect((await getImport(database, s.owner.companyId, id)).result).toEqual(
      job.result,
    );
    expect(await database.select().from(bankTransactions)).toHaveLength(20);
  });

  it("imports a CSV statement with the suggested columns and the last balance", async () => {
    const s = await setup();
    const { id, preview } = await importFile(s, "statement.csv");
    expect(preview).toMatchObject({
      format: "csv",
      summary: { movements: 8, credits: 5, debits: 3 },
      closing_balance_cents: 111_975,
    });
    const job = await confirmAndApply(s, id);
    expect(job.result).toEqual({ created: 8, duplicates: 0 });
  });

  it("rejects a statement of another account", async () => {
    const s = await setup();
    await database
      .update(collectionMethods)
      .set({ iban: "ES0021000002000123456789" })
      .where(eq(collectionMethods.id, s.methodId));
    const { id } = await importFile(s, "sample.n43");
    const job = await getImport(database, s.owner.companyId, id);
    expect(job).toMatchObject({
      status: "rejected",
      errorCode: "account_mismatch",
    });
  });

  it("is Pro only and needs a bank account method", async () => {
    const s = await setup();
    const file = new File(["x"], "x.csv");
    const common = {
      database,
      bucket: s.bucket,
      queue: recordingQueue(),
      companyId: s.owner.companyId,
      file,
    };
    const basic = await createBankImport({
      ...common,
      plan: "essential",
      collectionMethodId: s.methodId,
    }).catch((error) => toApiError(error));
    expect(basic).toMatchObject({ code: "feature_not_in_plan" });

    const [cash] = await database
      .insert(collectionMethods)
      .values({
        id: crypto.randomUUID(),
        companyId: s.owner.companyId,
        kind: "cash",
        label: "Efectivo",
      })
      .returning({ id: collectionMethods.id });
    const wrongKind = await createBankImport({
      ...common,
      plan: "pro",
      collectionMethodId: cash?.id as string,
    }).catch((error) => toApiError(error));
    expect(wrongKind).toMatchObject({ code: "validation_error" });
  });
});

describe("reconciliation", () => {
  it("suggests the right invoice for at least 80 % of the income (SC-009) and confirming pays them", async () => {
    const s = await setup();
    const invoices = await seedInvoices(s.owner);
    await confirmAndApply(s, (await importFile(s, "sample.n43")).id);

    const suggestions = await reconciliationSuggestions({
      database,
      context: contextOf(s.owner),
    });
    const wanted = new Map(
      expected.invoices.map((item) => [
        item.allocation_cents,
        invoices.get(item.invoice) as string,
      ]),
    );
    const correct = suggestions.filter(
      (suggestion) =>
        wanted.get(suggestion.transaction.amountCents) ===
        suggestion.documentId,
    );
    expect(correct.length / expected.credit_count).toBeGreaterThanOrEqual(0.8);
    // Debits are never proposed.
    expect(
      suggestions.every((suggestion) => suggestion.transaction.amountCents > 0),
    ).toBe(true);
    // The partial payment is allocated up to the movement.
    const partial = suggestions.find(
      (suggestion) => suggestion.invoice.fullNumber === "F-2026-0015",
    );
    expect(partial?.allocationCents).toBe(50_000);

    for (const [index, suggestion] of correct.entries()) {
      await createReconciliation({
        database,
        context: contextOf(s.owner),
        idempotencyKey: `confirm-suggestion-${String(index).padStart(4, "0")}`,
        data: {
          bank_transaction_id: suggestion.transactionId,
          allocations: [
            {
              document_id: suggestion.documentId,
              amount_cents: suggestion.allocationCents,
            },
          ],
          confirmed_overpayment: false,
        },
      });
    }
    for (const item of expected.invoices) {
      const paid = await paidOf(invoices.get(item.invoice) as string);
      if (
        correct.some(
          (suggestion) => suggestion.invoice.fullNumber === item.invoice,
        )
      ) {
        expect(paid).toBe(item.allocation_cents);
      }
    }
  });

  it("allocates one movement to two invoices and two movements to one invoice", async () => {
    const s = await setup();
    const a = await invoiceFor(s.owner, "A-0001", 10_000);
    const b = await invoiceFor(s.owner, "A-0002", 6_000);
    const oneToMany = await rawTransaction(s, 16_000);
    await createReconciliation({
      database,
      context: contextOf(s.owner),
      idempotencyKey: "one-to-many-key-0001",
      data: {
        bank_transaction_id: oneToMany,
        allocations: [
          { document_id: a, amount_cents: 10_000 },
          { document_id: b, amount_cents: 6_000 },
        ],
        confirmed_overpayment: false,
      },
    });
    expect([await paidOf(a), await paidOf(b)]).toEqual([10_000, 6_000]);
    const [listed] = (
      await listBankTransactions({
        database,
        context: contextOf(s.owner),
        limit: 10,
      })
    ).items;
    expect(listed).toMatchObject({
      status: "reconciled",
      allocatedCents: 16_000,
    });
    expect(listed?.reconciliations).toHaveLength(2);

    const c = await invoiceFor(s.owner, "A-0003", 9_000);
    const first = await rawTransaction(s, 4_000);
    const second = await rawTransaction(s, 5_000);
    for (const [key, id, amount] of [
      ["many-to-one-key-0001", first, 4_000],
      ["many-to-one-key-0002", second, 5_000],
    ] as const) {
      await createReconciliation({
        database,
        context: contextOf(s.owner),
        idempotencyKey: key,
        data: {
          bank_transaction_id: id,
          allocations: [{ document_id: c, amount_cents: amount }],
          confirmed_overpayment: false,
        },
      });
    }
    expect(await paidOf(c)).toBe(9_000);
  });

  it("rejects allocating more than the movement, also under concurrency", async () => {
    const s = await setup();
    const invoice = await invoiceFor(s.owner, "B-0001", 50_000);
    const tx = await rawTransaction(s, 10_000);
    const tooMuch = await createReconciliation({
      database,
      context: contextOf(s.owner),
      idempotencyKey: "too-much-key-00000001",
      data: {
        bank_transaction_id: tx,
        allocations: [{ document_id: invoice, amount_cents: 10_001 }],
        confirmed_overpayment: false,
      },
    }).catch((error) => toApiError(error));
    expect(tooMuch).toMatchObject({ code: "validation_error" });

    const attempts = await Promise.allSettled(
      Array.from({ length: 4 }, (_, index) =>
        createReconciliation({
          database,
          context: contextOf(s.owner),
          idempotencyKey: `race-key-0000000000${index}`,
          data: {
            bank_transaction_id: tx,
            allocations: [{ document_id: invoice, amount_cents: 6_000 }],
            confirmed_overpayment: false,
          },
        }),
      ),
    );
    expect(
      attempts.filter((attempt) => attempt.status === "fulfilled"),
    ).toHaveLength(1);
    expect(await paidOf(invoice)).toBe(6_000);
    const [row] = await database
      .select({ sum: reconciliations.amountCents })
      .from(reconciliations)
      .where(eq(reconciliations.bankTransactionId, tx));
    expect(row?.sum).toBe(6_000);
  });

  it("applies the v1 overpayment rule and replays idempotently", async () => {
    const s = await setup();
    const invoice = await invoiceFor(s.owner, "C-0001", 3_000);
    const tx = await rawTransaction(s, 5_000);
    const data = {
      bank_transaction_id: tx,
      allocations: [{ document_id: invoice, amount_cents: 4_000 }],
      confirmed_overpayment: false,
    };
    const refused = await createReconciliation({
      database,
      context: contextOf(s.owner),
      idempotencyKey: "overpay-key-000000001",
      data,
    }).catch((error) => toApiError(error));
    expect(refused).toMatchObject({
      code: "overpayment_confirmation_required",
    });
    expect(await paidOf(invoice)).toBe(0);

    const confirmed = { ...data, confirmed_overpayment: true };
    const first = await createReconciliation({
      database,
      context: contextOf(s.owner),
      idempotencyKey: "overpay-key-000000002",
      data: confirmed,
    });
    const replay = await createReconciliation({
      database,
      context: contextOf(s.owner),
      idempotencyKey: "overpay-key-000000002",
      data: confirmed,
    });
    expect(replay.reconciliationIds).toEqual(first.reconciliationIds);
    expect(await paidOf(invoice)).toBe(4_000);
  });

  it("undo deletes the payment (audited); deleting the payment also undoes the allocation", async () => {
    const s = await setup();
    const invoice = await invoiceFor(s.owner, "D-0001", 8_000);
    const tx = await rawTransaction(s, 8_000);
    const { reconciliationIds } = await createReconciliation({
      database,
      context: contextOf(s.owner),
      idempotencyKey: "undo-key-00000000001",
      data: {
        bank_transaction_id: tx,
        allocations: [{ document_id: invoice, amount_cents: 8_000 }],
        confirmed_overpayment: false,
      },
    });
    await deleteReconciliation({
      database,
      context: contextOf(s.owner),
      reconciliationId: reconciliationIds[0] as string,
    });
    expect(await paidOf(invoice)).toBe(0);
    const events = await database
      .select({ event: documentEvents.event })
      .from(documentEvents)
      .where(eq(documentEvents.documentId, invoice))
      .orderBy(asc(documentEvents.createdAt));
    expect(events.map((row) => row.event)).toEqual(
      expect.arrayContaining(["payment_added", "payment_deleted"]),
    );
    const [after] = (
      await listBankTransactions({
        database,
        context: contextOf(s.owner),
        limit: 10,
      })
    ).items;
    expect(after?.status).toBe("pending");

    // Deleting the payment from the invoice side cascades.
    const again = await createReconciliation({
      database,
      context: contextOf(s.owner),
      idempotencyKey: "undo-key-00000000002",
      data: {
        bank_transaction_id: tx,
        allocations: [{ document_id: invoice, amount_cents: 8_000 }],
        confirmed_overpayment: false,
      },
    });
    await database.delete(payments).where(eq(payments.documentId, invoice));
    expect(
      await database
        .select({ id: reconciliations.id })
        .from(reconciliations)
        .where(eq(reconciliations.id, again.reconciliationIds[0] as string)),
    ).toEqual([]);
  });

  it("ignores and restores movements, but not ones already allocated", async () => {
    const s = await setup();
    const invoice = await invoiceFor(s.owner, "E-0001", 1_000);
    const loose = await rawTransaction(s, 1_000, "OTRO INGRESO");
    await setTransactionIgnored({
      database,
      context: contextOf(s.owner),
      transactionId: loose,
      ignored: true,
    });
    const ignored = await createReconciliation({
      database,
      context: contextOf(s.owner),
      idempotencyKey: "ignored-key-0000000001",
      data: {
        bank_transaction_id: loose,
        allocations: [{ document_id: invoice, amount_cents: 1_000 }],
        confirmed_overpayment: false,
      },
    }).catch((error) => toApiError(error));
    expect(ignored).toMatchObject({ code: "conflict" });
    expect(
      (
        await reconciliationSuggestions({
          database,
          context: contextOf(s.owner),
        })
      ).length,
    ).toBe(0);

    await setTransactionIgnored({
      database,
      context: contextOf(s.owner),
      transactionId: loose,
      ignored: false,
    });
    await createReconciliation({
      database,
      context: contextOf(s.owner),
      idempotencyKey: "ignored-key-0000000002",
      data: {
        bank_transaction_id: loose,
        allocations: [{ document_id: invoice, amount_cents: 1_000 }],
        confirmed_overpayment: false,
      },
    });
    const blocked = await setTransactionIgnored({
      database,
      context: contextOf(s.owner),
      transactionId: loose,
      ignored: true,
    }).catch((error) => toApiError(error));
    expect(blocked).toMatchObject({ code: "conflict" });
  });

  it("never touches another company's movements or invoices (404/409)", async () => {
    const mine = await setup();
    const other = await setup();
    const foreignInvoice = await invoiceFor(other.owner, "Z-0001", 1_000);
    const myTx = await rawTransaction(mine, 1_000);
    const foreignTx = await rawTransaction(other, 1_000);

    const useForeignInvoice = await createReconciliation({
      database,
      context: contextOf(mine.owner),
      idempotencyKey: "foreign-key-000000001",
      data: {
        bank_transaction_id: myTx,
        allocations: [{ document_id: foreignInvoice, amount_cents: 1_000 }],
        confirmed_overpayment: false,
      },
    }).catch((error) => toApiError(error));
    expect(useForeignInvoice).toMatchObject({ code: "conflict" });

    const useForeignTx = await createReconciliation({
      database,
      context: contextOf(mine.owner),
      idempotencyKey: "foreign-key-000000002",
      data: {
        bank_transaction_id: foreignTx,
        allocations: [{ document_id: foreignInvoice, amount_cents: 1_000 }],
        confirmed_overpayment: false,
      },
    }).catch((error) => toApiError(error));
    expect(useForeignTx).toMatchObject({ status: 404 });
    expect(await paidOf(foreignInvoice)).toBe(0);
  });

  it("requires Pro", async () => {
    const s = await setup();
    const result = await listBankTransactions({
      database,
      context: contextOf(s.owner, "basic"),
      limit: 10,
    }).catch((error) => toApiError(error));
    expect(result).toMatchObject({ code: "feature_not_in_plan" });
  });
});

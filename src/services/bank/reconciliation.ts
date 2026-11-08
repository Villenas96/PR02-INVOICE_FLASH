import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";

import { createDatabase, type Database } from "@/db";
import { firstExecutionRow } from "@/db/result";
import { bankTransactions } from "@/db/schema/bank-transaction";
import { clients } from "@/db/schema/client";
import { documents } from "@/db/schema/document";
import { documentEvents } from "@/db/schema/document-event";
import { payments } from "@/db/schema/payment";
import { reconciliations } from "@/db/schema/reconciliation";
import { ApiError } from "@/lib/api/errors";
import { decodeIdCursor, encodeIdCursor } from "@/lib/api/pagination";
import {
  type MatchCandidate,
  type Suggestion,
  suggestAll,
} from "@/lib/bank/matching";
import { createUuidV7, deterministicUuid } from "@/lib/ids";
import { type CompanyContext, ResourceNotFoundError } from "@/services/context";
import { requireFeature } from "@/services/entitlements";

export type TransactionStatus =
  | "pending"
  | "partial"
  | "reconciled"
  | "ignored";

export const createReconciliationSchema = z
  .object({
    bank_transaction_id: z.string().uuid(),
    allocations: z
      .array(
        z
          .object({
            document_id: z.string().uuid(),
            amount_cents: z.number().int().min(1).max(2_147_483_647),
          })
          .strict(),
      )
      .min(1)
      .max(50)
      .refine(
        (allocations) =>
          new Set(allocations.map((entry) => entry.document_id)).size ===
          allocations.length,
        { message: "No repitas la misma factura en un casamiento." },
      ),
    confirmed_overpayment: z.boolean().optional().default(false),
  })
  .strict();
export type CreateReconciliationInput = z.output<
  typeof createReconciliationSchema
>;

function statusOf(row: {
  ignoredAt: Date | null;
  amountCents: number;
  allocatedCents: number;
}): TransactionStatus {
  if (row.ignoredAt) {
    return "ignored";
  }
  if (row.allocatedCents <= 0) {
    return "pending";
  }
  return row.allocatedCents >= row.amountCents ? "reconciled" : "partial";
}

// Explicit table names: Drizzle leaves a correlated outer column unqualified
// when it renders a single-table query, which would bind to the inner table.
const allocatedExpression = sql<number>`coalesce((
  SELECT sum(allocation.amount_cents)
  FROM reconciliation allocation
  WHERE allocation.bank_transaction_id = bank_transaction.id
), 0)::bigint`.mapWith(Number);

const paidExpression = sql<number>`coalesce((
  SELECT sum(paid_payment.amount_cents) FROM payment paid_payment
  WHERE paid_payment.document_id = document.id
), 0)::bigint`.mapWith(Number);

// ------------------------------------------------------------------ read ---

export async function listBankTransactions(input: {
  database?: Database;
  context: CompanyContext;
  status?: TransactionStatus;
  limit: number;
  cursor?: string;
}) {
  requireFeature(input.context, "bank_reconciliation");
  const database = input.database ?? createDatabase();
  const afterId = decodeIdCursor(input.cursor);
  const allocated = allocatedExpression;
  const rows = await database
    .select({
      id: bankTransactions.id,
      operationOn: bankTransactions.operationOn,
      valueOn: bankTransactions.valueOn,
      amountCents: bankTransactions.amountCents,
      concept: bankTransactions.concept,
      ignoredAt: bankTransactions.ignoredAt,
      collectionMethodId: bankTransactions.collectionMethodId,
      allocatedCents: allocated,
    })
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.companyId, input.context.companyId),
        afterId ? lt(bankTransactions.id, afterId) : undefined,
        input.status === "ignored"
          ? sql`${bankTransactions.ignoredAt} IS NOT NULL`
          : input.status
            ? sql`${bankTransactions.ignoredAt} IS NULL AND ${
                input.status === "pending"
                  ? sql`${allocated} = 0`
                  : input.status === "partial"
                    ? sql`${allocated} > 0 AND ${allocated} < ${bankTransactions.amountCents}`
                    : sql`${allocated} >= ${bankTransactions.amountCents}`
              }`
            : undefined,
      ),
    )
    .orderBy(desc(bankTransactions.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  const links =
    page.length === 0
      ? []
      : await database
          .select({
            id: reconciliations.id,
            transactionId: reconciliations.bankTransactionId,
            documentId: reconciliations.documentId,
            documentNumber: documents.fullNumber,
            amountCents: reconciliations.amountCents,
          })
          .from(reconciliations)
          .innerJoin(documents, eq(documents.id, reconciliations.documentId))
          .where(
            inArray(
              reconciliations.bankTransactionId,
              page.map((row) => row.id),
            ),
          );
  return {
    items: page.map((row) => ({
      ...row,
      status: statusOf(row),
      reconciliations: links.filter((link) => link.transactionId === row.id),
    })),
    nextCursor:
      rows.length > input.limit && last ? encodeIdCursor(last.id) : null,
  };
}

const MAX_SUGGESTION_TRANSACTIONS = 200;
const MAX_CANDIDATE_INVOICES = 1_000;

export interface SuggestionView extends Suggestion {
  transaction: {
    operationOn: string;
    concept: string;
    amountCents: number;
  };
  invoice: {
    fullNumber: string;
    clientName: string | null;
    pendingCents: number;
  };
}

/** Suggestions for unmatched income, in two indexed queries (no N+1). */
export async function reconciliationSuggestions(input: {
  database?: Database;
  context: CompanyContext;
}): Promise<SuggestionView[]> {
  requireFeature(input.context, "bank_reconciliation");
  const database = input.database ?? createDatabase();
  const allocated = allocatedExpression;
  const transactions = await database
    .select({
      id: bankTransactions.id,
      operationOn: bankTransactions.operationOn,
      concept: bankTransactions.concept,
      amountCents: bankTransactions.amountCents,
      allocatedCents: allocated,
    })
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.companyId, input.context.companyId),
        sql`${bankTransactions.amountCents} > 0`,
        sql`${bankTransactions.ignoredAt} IS NULL`,
        sql`${bankTransactions.amountCents} > ${allocated}`,
      ),
    )
    .orderBy(desc(bankTransactions.operationOn))
    .limit(MAX_SUGGESTION_TRANSACTIONS);
  if (transactions.length === 0) {
    return [];
  }

  const paid = paidExpression;
  const invoices = await database
    .select({
      documentId: documents.id,
      fullNumber: documents.fullNumber,
      dueDate: documents.dueDate,
      totalCents: documents.totalCents,
      paidCents: paid,
      clientName: clients.name,
      clientTaxId: clients.taxId,
    })
    .from(documents)
    .leftJoin(clients, eq(clients.id, documents.clientId))
    .where(
      and(
        eq(documents.companyId, input.context.companyId),
        eq(documents.documentType, "invoice"),
        eq(documents.status, "issued"),
        sql`${documents.deletedAt} IS NULL`,
        sql`${documents.totalCents} > ${paid}`,
      ),
    )
    .limit(MAX_CANDIDATE_INVOICES);
  const candidates: MatchCandidate[] = invoices.map((invoice) => ({
    documentId: invoice.documentId,
    fullNumber: invoice.fullNumber ?? "",
    clientName: invoice.clientName,
    clientTaxId: invoice.clientTaxId,
    pendingCents: invoice.totalCents - invoice.paidCents,
    dueDate: invoice.dueDate,
  }));
  const byDocument = new Map(
    candidates.map((candidate) => [candidate.documentId, candidate]),
  );
  const byTransaction = new Map(transactions.map((row) => [row.id, row]));

  return suggestAll(transactions, candidates).flatMap((suggestion) => {
    const transaction = byTransaction.get(suggestion.transactionId);
    const invoice = byDocument.get(suggestion.documentId);
    return transaction && invoice
      ? [
          {
            ...suggestion,
            transaction: {
              operationOn: transaction.operationOn,
              concept: transaction.concept,
              amountCents: transaction.amountCents,
            },
            invoice: {
              fullNumber: invoice.fullNumber,
              clientName: invoice.clientName,
              pendingCents: invoice.pendingCents,
            },
          },
        ]
      : [];
  });
}

// ----------------------------------------------------------------- write ---

function isUniqueViolation(error: unknown): boolean {
  for (
    let current: unknown = error, depth = 0;
    current && depth < 4;
    current = (current as { cause?: unknown }).cause, depth += 1
  ) {
    const { code, message } = current as { code?: string; message?: string };
    if (code === "23505" || message?.includes("duplicate key")) {
      return true;
    }
  }
  return false;
}

interface AllocationRow {
  document_id: string;
  amount_cents: number;
  payment_id: string;
  reconciliation_id: string;
  event_id: string;
}

/**
 * Allocates (part of) an income movement to one or more invoices (FR-045),
 * creating a payment per allocation. One statement: the movement and the
 * invoices are locked `FOR UPDATE`, so concurrent confirmations serialize
 * and the sum allocated can never exceed the movement. The ids derive from
 * the `Idempotency-Key`, so a replay finds what it already created.
 */
export async function createReconciliation(input: {
  database?: Database;
  context: CompanyContext;
  data: CreateReconciliationInput;
  idempotencyKey: string;
  now?: Date;
}): Promise<{ reconciliationIds: string[] }> {
  requireFeature(input.context, "bank_reconciliation");
  const database = input.database ?? createDatabase();
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const { companyId, userId } = input.context;
  const { data } = input;

  const rows: AllocationRow[] = await Promise.all(
    data.allocations.map(async (allocation) => ({
      document_id: allocation.document_id,
      amount_cents: allocation.amount_cents,
      payment_id: await deterministicUuid(
        companyId,
        "reconciliation-payment",
        input.idempotencyKey,
        allocation.document_id,
      ),
      reconciliation_id: await deterministicUuid(
        companyId,
        "reconciliation",
        input.idempotencyKey,
        allocation.document_id,
      ),
      event_id: createUuidV7(now.getTime()),
    })),
  );

  const existing = await database
    .select({ id: reconciliations.id })
    .from(reconciliations)
    .where(
      and(
        eq(reconciliations.companyId, companyId),
        inArray(
          reconciliations.id,
          rows.map((row) => row.reconciliation_id),
        ),
      ),
    );
  if (existing.length === rows.length) {
    return { reconciliationIds: existing.map((row) => row.id) };
  }

  let outcome: string | undefined;
  try {
    const result = await database.execute<{ outcome: string }>(sql`
      WITH locked_tx AS MATERIALIZED (
        SELECT t.id, t.company_id, t.amount_cents, t.operation_on, t.ignored_at
        FROM ${bankTransactions} t
        WHERE t.id = ${data.bank_transaction_id}::uuid
          AND t.company_id = ${companyId}::uuid
        FOR UPDATE
      ),
      allocated AS MATERIALIZED (
        SELECT coalesce(sum(r.amount_cents), 0)::bigint AS cents
        FROM ${reconciliations} r
        JOIN locked_tx ON locked_tx.id = r.bank_transaction_id
      ),
      input_rows AS MATERIALIZED (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS a(
          document_id uuid, amount_cents integer, payment_id uuid,
          reconciliation_id uuid, event_id uuid
        )
      ),
      locked_docs AS MATERIALIZED (
        SELECT d.id, d.company_id, d.total_cents
        FROM ${documents} d
        JOIN input_rows ON input_rows.document_id = d.id
        WHERE d.company_id = ${companyId}::uuid
          AND d.deleted_at IS NULL
          AND d.status = 'issued'::document_status
          AND d.document_type = 'invoice'::document_type
        ORDER BY d.id
        FOR UPDATE OF d
      ),
      paid AS MATERIALIZED (
        SELECT p.document_id, sum(p.amount_cents)::bigint AS cents
        FROM ${payments} p
        JOIN locked_docs ON locked_docs.id = p.document_id
        GROUP BY p.document_id
      ),
      verdict AS MATERIALIZED (
        SELECT
          EXISTS (SELECT 1 FROM locked_tx) AS has_tx,
          coalesce((SELECT amount_cents > 0 AND ignored_at IS NULL FROM locked_tx), false) AS tx_ok,
          (SELECT count(*) FROM locked_docs) = (SELECT count(*) FROM input_rows) AS docs_ok,
          coalesce((SELECT allocated.cents + (SELECT sum(amount_cents) FROM input_rows)
            <= (SELECT amount_cents FROM locked_tx) FROM allocated), false) AS fits,
          EXISTS (
            SELECT 1 FROM input_rows
            JOIN locked_docs ON locked_docs.id = input_rows.document_id
            LEFT JOIN paid ON paid.document_id = locked_docs.id
            WHERE input_rows.amount_cents >
              greatest(locked_docs.total_cents - coalesce(paid.cents, 0), 0)
          ) AS overpays
      ),
      accepted AS MATERIALIZED (
        SELECT * FROM verdict
        WHERE has_tx AND tx_ok AND docs_ok AND fits
          AND (NOT overpays OR ${data.confirmed_overpayment}::boolean)
      ),
      inserted_payments AS (
        INSERT INTO ${payments} (
          id, company_id, document_id, amount_cents, confirmed_overpayment,
          paid_on, method, created_at, updated_at
        )
        SELECT input_rows.payment_id, locked_docs.company_id, locked_docs.id,
          input_rows.amount_cents,
          input_rows.amount_cents >
            greatest(locked_docs.total_cents - coalesce(paid.cents, 0), 0),
          (SELECT operation_on FROM locked_tx), 'transfer'::payment_method,
          ${nowIso}, ${nowIso}
        FROM input_rows
        JOIN locked_docs ON locked_docs.id = input_rows.document_id
        LEFT JOIN paid ON paid.document_id = locked_docs.id
        CROSS JOIN accepted
        RETURNING id, document_id, amount_cents
      ),
      inserted_reconciliations AS (
        INSERT INTO ${reconciliations} (
          id, company_id, bank_transaction_id, document_id, payment_id,
          amount_cents, created_by, created_at
        )
        SELECT input_rows.reconciliation_id, ${companyId}::uuid,
          ${data.bank_transaction_id}::uuid, input_rows.document_id,
          input_rows.payment_id, input_rows.amount_cents, ${userId}::uuid,
          ${nowIso}
        FROM input_rows
        JOIN inserted_payments ON inserted_payments.id = input_rows.payment_id
        RETURNING id
      ),
      inserted_events AS (
        INSERT INTO ${documentEvents} (
          id, company_id, document_id, actor, event, payload, created_at
        )
        SELECT input_rows.event_id, ${companyId}::uuid, input_rows.document_id,
          ${`user:${userId}`}, 'payment_added'::document_event_type,
          jsonb_build_object(
            'payment_id', input_rows.payment_id,
            'amount_cents', input_rows.amount_cents,
            'source', 'bank_reconciliation'
          ),
          ${nowIso}
        FROM input_rows
        JOIN inserted_payments ON inserted_payments.id = input_rows.payment_id
        RETURNING id
      )
      SELECT CASE
        WHEN NOT verdict.has_tx THEN 'not_found'
        WHEN NOT verdict.tx_ok THEN 'not_eligible'
        WHEN NOT verdict.docs_ok THEN 'invoices_invalid'
        WHEN NOT verdict.fits THEN 'over_allocated'
        WHEN verdict.overpays AND NOT ${data.confirmed_overpayment}::boolean
          THEN 'overpayment'
        ELSE 'created'
      END AS outcome
      FROM verdict
      WHERE (SELECT count(*) FROM inserted_reconciliations) >= 0
        AND (SELECT count(*) FROM inserted_events) >= 0
    `);
    outcome = firstExecutionRow<{ outcome: string }>(result)?.outcome;
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    // A concurrent request with the same key created these rows first.
    return {
      reconciliationIds: rows.map((row) => row.reconciliation_id),
    };
  }

  switch (outcome) {
    case "created":
      return { reconciliationIds: rows.map((row) => row.reconciliation_id) };
    case "not_found":
      throw new ResourceNotFoundError();
    case "not_eligible":
      throw new ApiError(
        "conflict",
        409,
        "Este movimiento es un cargo o está ignorado: no se puede casar con facturas.",
      );
    case "invoices_invalid":
      throw new ApiError(
        "conflict",
        409,
        "Solo puedes casar movimientos con facturas emitidas de tu empresa.",
      );
    case "over_allocated":
      throw new ApiError(
        "validation_error",
        400,
        "La suma asignada supera el importe del movimiento.",
        { allocations: "No puedes asignar más de lo que ingresó el banco." },
      );
    case "overpayment":
      throw new ApiError(
        "overpayment_confirmation_required",
        409,
        "El importe supera el pendiente de una factura. Confirma que quieres registrar un sobrepago.",
      );
    default:
      throw new Error("No se ha podido registrar el casamiento.");
  }
}

/** Undo: deletes the payment (the allocation goes with it) and audits it. */
export async function deleteReconciliation(input: {
  database?: Database;
  context: CompanyContext;
  reconciliationId: string;
  now?: Date;
}): Promise<void> {
  requireFeature(input.context, "bank_reconciliation");
  const database = input.database ?? createDatabase();
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const result = await database.execute<{ document_id: string }>(sql`
    WITH target AS MATERIALIZED (
      SELECT r.id, r.payment_id, r.document_id, r.company_id, r.amount_cents
      FROM ${reconciliations} r
      WHERE r.id = ${input.reconciliationId}::uuid
        AND r.company_id = ${input.context.companyId}::uuid
      FOR UPDATE OF r
    ),
    deleted_payment AS (
      DELETE FROM ${payments} p
      USING target
      WHERE p.id = target.payment_id
      RETURNING target.document_id, target.company_id, target.payment_id,
        target.amount_cents
    ),
    event AS (
      INSERT INTO ${documentEvents} (
        id, company_id, document_id, actor, event, payload, created_at
      )
      SELECT ${createUuidV7(now.getTime())}, deleted_payment.company_id,
        deleted_payment.document_id, ${`user:${input.context.userId}`},
        'payment_deleted'::document_event_type,
        jsonb_build_object(
          'payment_id', deleted_payment.payment_id,
          'amount_cents', deleted_payment.amount_cents,
          'source', 'bank_reconciliation_undo'
        ),
        ${nowIso}
      FROM deleted_payment
      RETURNING document_id
    )
    SELECT document_id FROM event
  `);
  if (!firstExecutionRow(result)) {
    throw new ResourceNotFoundError();
  }
}

/** «Ignore» a movement that is not an invoice payment (US12-AC6). */
export async function setTransactionIgnored(input: {
  database?: Database;
  context: CompanyContext;
  transactionId: string;
  ignored: boolean;
  now?: Date;
}): Promise<void> {
  requireFeature(input.context, "bank_reconciliation");
  const database = input.database ?? createDatabase();
  const now = input.now ?? new Date();
  const [updated] = await database
    .update(bankTransactions)
    .set({ ignoredAt: input.ignored ? now : null })
    .where(
      and(
        eq(bankTransactions.id, input.transactionId),
        eq(bankTransactions.companyId, input.context.companyId),
        input.ignored
          ? sql`NOT EXISTS (
              SELECT 1 FROM ${reconciliations}
              WHERE ${reconciliations.bankTransactionId} = ${bankTransactions.id}
            )`
          : undefined,
      ),
    )
    .returning({ id: bankTransactions.id });
  if (updated) {
    return;
  }
  const [exists] = await database
    .select({ id: bankTransactions.id })
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.id, input.transactionId),
        eq(bankTransactions.companyId, input.context.companyId),
      ),
    );
  if (!exists) {
    throw new ResourceNotFoundError();
  }
  throw new ApiError(
    "conflict",
    409,
    "Deshaz primero los casamientos de este movimiento para ignorarlo.",
  );
}

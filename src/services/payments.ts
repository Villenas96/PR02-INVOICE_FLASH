import { sql } from "drizzle-orm";

import type { Database } from "@/db";
import { firstExecutionRow } from "@/db/result";
import { documents } from "@/db/schema/document";
import { documentEvents } from "@/db/schema/document-event";
import { payments } from "@/db/schema/payment";
import { ApiError, ResourceNotFoundError } from "@/lib/api/errors";
import { createUuidV7 } from "@/lib/ids";

export type PaymentMethod = "card" | "cash" | "other" | "transfer";

export interface PaymentRecord {
  id: string;
  documentId: string;
  amountCents: number;
  confirmedOverpayment: boolean;
  paidOn: string;
  method: PaymentMethod | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePaymentInput {
  companyId: string;
  documentId: string;
  actor: string;
  amountCents: number;
  paidOn: string;
  method: PaymentMethod | null;
  confirmedOverpayment: boolean;
}

export interface UpdatePaymentInput {
  companyId: string;
  paymentId: string;
  actor: string;
  amountCents?: number;
  paidOn?: string;
  method?: PaymentMethod | null;
  confirmedOverpayment: boolean;
}

export interface DeletePaymentInput {
  companyId: string;
  paymentId: string;
  actor: string;
}

interface OutcomeRow extends Record<string, unknown> {
  outcome:
    | "created"
    | "not_eligible"
    | "overpayment_confirmation_required"
    | "updated";
  payment_id: string | null;
}

function overpaymentError(): ApiError {
  return new ApiError(
    "overpayment_confirmation_required",
    409,
    "El importe supera el pendiente de la factura. Confirma que quieres registrar un sobrepago.",
  );
}

function notEligibleError(): ApiError {
  return new ApiError(
    "conflict",
    409,
    "Solo puedes registrar cobros en facturas emitidas.",
  );
}

async function loadPayment(
  database: Database,
  companyId: string,
  paymentId: string,
): Promise<PaymentRecord> {
  const [payment] = await database
    .select()
    .from(payments)
    .where(
      sql`${payments.id} = ${paymentId} AND ${payments.companyId} = ${companyId}`,
    )
    .limit(1);

  if (!payment) {
    throw new ResourceNotFoundError();
  }

  return {
    id: payment.id,
    documentId: payment.documentId,
    amountCents: payment.amountCents,
    confirmedOverpayment: payment.confirmedOverpayment,
    paidOn: payment.paidOn,
    method: payment.method,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

/**
 * Locks the target document before recomputing its paid total so concurrent
 * payment writes on the same document serialize instead of racing past the
 * overpayment check (same guarding pattern as `document-issuance.ts`).
 */
export async function createPayment(
  input: CreatePaymentInput,
  dependencies: { database: Database; now?: Date },
): Promise<PaymentRecord> {
  const now = dependencies.now ?? new Date();
  const nowIso = now.toISOString();
  const paymentId = createUuidV7(now.getTime());
  const eventId = createUuidV7(now.getTime());

  const result = await dependencies.database.execute<OutcomeRow>(sql`
    WITH locked_document AS MATERIALIZED (
      SELECT
        target.id,
        target.company_id,
        target.total_cents,
        target.status,
        target.document_type
      FROM ${documents} target
      WHERE target.id = ${input.documentId}
        AND target.company_id = ${input.companyId}
        AND target.deleted_at IS NULL
      FOR UPDATE
    ),
    current_paid AS MATERIALIZED (
      SELECT COALESCE(SUM(existing.amount_cents), 0)::integer AS paid_cents
      FROM ${payments} existing
      JOIN locked_document ON locked_document.id = existing.document_id
    ),
    target AS MATERIALIZED (
      SELECT locked_document.*, current_paid.paid_cents
      FROM locked_document
      CROSS JOIN current_paid
    ),
    eligible AS MATERIALIZED (
      SELECT *
      FROM target
      WHERE status = 'issued'::document_status
        AND document_type = 'invoice'::document_type
    ),
    overpay_check AS MATERIALIZED (
      SELECT
        eligible.*,
        (${input.amountCents} > GREATEST(eligible.total_cents - eligible.paid_cents, 0))
          AS is_overpayment
      FROM eligible
    ),
    accepted AS MATERIALIZED (
      SELECT *
      FROM overpay_check
      WHERE NOT is_overpayment OR ${input.confirmedOverpayment}::boolean
    ),
    inserted_payment AS (
      INSERT INTO ${payments} (
        id,
        company_id,
        document_id,
        amount_cents,
        confirmed_overpayment,
        paid_on,
        method,
        created_at,
        updated_at
      )
      SELECT
        ${paymentId},
        accepted.company_id,
        accepted.id,
        ${input.amountCents},
        accepted.is_overpayment,
        ${input.paidOn},
        ${input.method}::payment_method,
        ${nowIso},
        ${nowIso}
      FROM accepted
      RETURNING id, document_id, company_id, amount_cents
    ),
    inserted_event AS (
      INSERT INTO ${documentEvents} (
        id,
        company_id,
        document_id,
        actor,
        event,
        payload,
        created_at
      )
      SELECT
        ${eventId},
        inserted_payment.company_id,
        inserted_payment.document_id,
        ${input.actor},
        'payment_added'::document_event_type,
        jsonb_build_object(
          'payment_id', inserted_payment.id,
          'amount_cents', inserted_payment.amount_cents
        ),
        ${nowIso}
      FROM inserted_payment
      RETURNING document_id
    )
    SELECT 'created'::text AS outcome, inserted_payment.id AS payment_id
    FROM inserted_payment
    JOIN inserted_event ON inserted_event.document_id = inserted_payment.document_id
    UNION ALL
    SELECT 'not_eligible'::text AS outcome, NULL::uuid AS payment_id
    FROM target
    WHERE NOT EXISTS (SELECT 1 FROM eligible)
    UNION ALL
    SELECT 'overpayment_confirmation_required'::text AS outcome, NULL::uuid AS payment_id
    FROM overpay_check
    WHERE NOT EXISTS (SELECT 1 FROM accepted)
  `);

  const row = firstExecutionRow<OutcomeRow>(result);
  if (!row) {
    throw new ResourceNotFoundError();
  }
  if (row.outcome === "not_eligible") {
    throw notEligibleError();
  }
  if (row.outcome === "overpayment_confirmation_required") {
    throw overpaymentError();
  }
  if (!row.payment_id) {
    throw new Error("El pago no se ha podido registrar.");
  }

  return loadPayment(dependencies.database, input.companyId, row.payment_id);
}

export async function updatePayment(
  input: UpdatePaymentInput,
  dependencies: { database: Database; now?: Date },
): Promise<PaymentRecord> {
  const now = dependencies.now ?? new Date();
  const nowIso = now.toISOString();
  const eventId = createUuidV7(now.getTime());
  const amountProvided = input.amountCents !== undefined;
  const paidOnProvided = input.paidOn !== undefined;
  const methodProvided = input.method !== undefined;

  const result = await dependencies.database.execute<OutcomeRow>(sql`
    WITH target_payment AS MATERIALIZED (
      SELECT
        p.id,
        p.document_id,
        p.company_id,
        p.amount_cents AS old_amount_cents,
        p.paid_on AS old_paid_on,
        p.method AS old_method
      FROM ${payments} p
      WHERE p.id = ${input.paymentId}
        AND p.company_id = ${input.companyId}
    ),
    locked_document AS MATERIALIZED (
      SELECT d.id, d.total_cents
      FROM ${documents} d
      JOIN target_payment ON target_payment.document_id = d.id
      FOR UPDATE OF d
    ),
    other_paid AS MATERIALIZED (
      SELECT COALESCE(SUM(other.amount_cents), 0)::integer AS paid_cents
      FROM ${payments} other
      JOIN target_payment ON target_payment.document_id = other.document_id
      WHERE other.id <> target_payment.id
    ),
    candidate AS MATERIALIZED (
      SELECT
        target_payment.id,
        target_payment.document_id,
        target_payment.company_id,
        locked_document.total_cents,
        other_paid.paid_cents,
        CASE
          WHEN ${amountProvided}::boolean THEN ${input.amountCents ?? 0}::integer
          ELSE target_payment.old_amount_cents
        END AS candidate_amount_cents
      FROM target_payment
      CROSS JOIN locked_document
      CROSS JOIN other_paid
    ),
    overpay_check AS MATERIALIZED (
      SELECT
        candidate.*,
        (candidate.candidate_amount_cents >
          GREATEST(candidate.total_cents - candidate.paid_cents, 0)) AS is_overpayment
      FROM candidate
    ),
    accepted AS MATERIALIZED (
      SELECT *
      FROM overpay_check
      WHERE NOT is_overpayment OR ${input.confirmedOverpayment}::boolean
    ),
    updated_payment AS (
      UPDATE ${payments} p
      SET
        amount_cents = accepted.candidate_amount_cents,
        confirmed_overpayment = accepted.is_overpayment,
        paid_on = CASE
          WHEN ${paidOnProvided}::boolean THEN ${input.paidOn ?? null}
          ELSE p.paid_on
        END,
        method = CASE
          WHEN ${methodProvided}::boolean THEN ${input.method ?? null}::payment_method
          ELSE p.method
        END,
        updated_at = ${nowIso}
      FROM accepted
      WHERE p.id = accepted.id
      RETURNING p.id, p.document_id, p.company_id, p.amount_cents
    ),
    inserted_event AS (
      INSERT INTO ${documentEvents} (
        id,
        company_id,
        document_id,
        actor,
        event,
        payload,
        created_at
      )
      SELECT
        ${eventId},
        updated_payment.company_id,
        updated_payment.document_id,
        ${input.actor},
        'payment_updated'::document_event_type,
        jsonb_build_object(
          'payment_id', updated_payment.id,
          'amount_cents', updated_payment.amount_cents
        ),
        ${nowIso}
      FROM updated_payment
      RETURNING document_id
    )
    SELECT 'updated'::text AS outcome, updated_payment.id AS payment_id
    FROM updated_payment
    JOIN inserted_event ON inserted_event.document_id = updated_payment.document_id
    UNION ALL
    SELECT 'overpayment_confirmation_required'::text AS outcome, NULL::uuid AS payment_id
    FROM overpay_check
    WHERE NOT EXISTS (SELECT 1 FROM accepted)
  `);

  const row = firstExecutionRow<OutcomeRow>(result);
  if (!row) {
    throw new ResourceNotFoundError();
  }
  if (row.outcome === "overpayment_confirmation_required") {
    throw overpaymentError();
  }
  if (!row.payment_id) {
    throw new Error("El pago no se ha podido actualizar.");
  }

  return loadPayment(dependencies.database, input.companyId, row.payment_id);
}

export async function deletePayment(
  input: DeletePaymentInput,
  dependencies: { database: Database; now?: Date },
): Promise<void> {
  const now = dependencies.now ?? new Date();
  const nowIso = now.toISOString();
  const eventId = createUuidV7(now.getTime());

  const result = await dependencies.database.execute<{
    document_id: string;
  }>(sql`
    WITH target_payment AS MATERIALIZED (
      SELECT p.id, p.document_id, p.company_id, p.amount_cents
      FROM ${payments} p
      WHERE p.id = ${input.paymentId}
        AND p.company_id = ${input.companyId}
      FOR UPDATE OF p
    ),
    deleted_payment AS (
      DELETE FROM ${payments} p
      USING target_payment
      WHERE p.id = target_payment.id
      RETURNING
        target_payment.document_id,
        target_payment.company_id,
        target_payment.id,
        target_payment.amount_cents
    ),
    inserted_event AS (
      INSERT INTO ${documentEvents} (
        id,
        company_id,
        document_id,
        actor,
        event,
        payload,
        created_at
      )
      SELECT
        ${eventId},
        deleted_payment.company_id,
        deleted_payment.document_id,
        ${input.actor},
        'payment_deleted'::document_event_type,
        jsonb_build_object(
          'payment_id', deleted_payment.id,
          'amount_cents', deleted_payment.amount_cents
        ),
        ${nowIso}
      FROM deleted_payment
      RETURNING document_id
    )
    SELECT deleted_payment.document_id
    FROM deleted_payment
    JOIN inserted_event ON inserted_event.document_id = deleted_payment.document_id
  `);

  const row = firstExecutionRow<{ document_id: string }>(result);
  if (!row) {
    throw new ResourceNotFoundError();
  }
}

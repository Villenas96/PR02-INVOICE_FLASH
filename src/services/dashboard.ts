import { sql } from "drizzle-orm";

import { createDatabase, type Database } from "@/db";
import { executionRows } from "@/db/result";
import { addCalendarDays } from "@/lib/dates";

/**
 * Pro dashboard aggregates (FR-046, FR-047, SC-013). Everything is derived
 * from issued invoices (voided ones never count) and payments; amounts stay
 * in cents and nothing is cached. Dates are `YYYY-MM-DD` in Europe/Madrid.
 */

export interface Period {
  from?: string;
  to?: string;
}

const ISSUED_INVOICE = (companyId: string) => sql`
  d.company_id = ${companyId}::uuid
  AND d.document_type = 'invoice'::document_type
  AND d.status = 'issued'::document_status
  AND d.deleted_at IS NULL`;

function periodFilter(period: Period) {
  return sql`
    AND (${period.from ?? null}::date IS NULL OR d.issue_date >= ${period.from ?? null}::date)
    AND (${period.to ?? null}::date IS NULL OR d.issue_date <= ${period.to ?? null}::date)`;
}

export interface InvoicedFigures {
  invoicedBaseCents: number;
  invoicedTotalCents: number;
  invoiceCount: number;
  taxCollected: Array<{
    name: string;
    rate: string;
    baseCents: number;
    taxCents: number;
  }>;
}

export async function invoicedFigures(
  companyId: string,
  period: Period,
  database: Database = createDatabase(),
): Promise<InvoicedFigures> {
  const [totals, taxes] = await Promise.all([
    database.execute<{ base: string; total: string; count: string }>(sql`
      SELECT coalesce(sum(d.subtotal_cents), 0)::text AS base,
        coalesce(sum(d.total_cents), 0)::text AS total,
        count(*)::text AS count
      FROM document d
      WHERE ${ISSUED_INVOICE(companyId)} ${periodFilter(period)}
    `),
    database.execute<{
      name: string;
      rate: string;
      base: string;
      tax: string;
    }>(sql`
      SELECT coalesce(entry ->> 'name', 'IVA') AS name,
        entry ->> 'rate' AS rate,
        sum((entry ->> 'baseCents')::bigint)::text AS base,
        sum((entry ->> 'taxCents')::bigint)::text AS tax
      FROM document d, jsonb_array_elements(d.tax_breakdown) entry
      WHERE ${ISSUED_INVOICE(companyId)} ${periodFilter(period)}
      GROUP BY 1, 2
      ORDER BY 1, (entry ->> 'rate')::numeric DESC
    `),
  ]);
  const [row] = executionRows<{ base: string; total: string; count: string }>(
    totals,
  );
  return {
    invoicedBaseCents: Number(row?.base ?? 0),
    invoicedTotalCents: Number(row?.total ?? 0),
    invoiceCount: Number(row?.count ?? 0),
    taxCollected: executionRows<{
      name: string;
      rate: string;
      base: string;
      tax: string;
    }>(taxes).map((entry) => ({
      name: entry.name,
      rate: entry.rate,
      baseCents: Number(entry.base),
      taxCents: Number(entry.tax),
    })),
  };
}

export interface MonthlyPoint {
  /** `YYYY-MM`. */
  month: string;
  invoicedCents: number;
  collectedCents: number;
}

/** Invoiced (by issue month) vs collected (by payment month), 12 months. */
export async function monthlySeries(
  companyId: string,
  today: string,
  months = 12,
  database: Database = createDatabase(),
): Promise<MonthlyPoint[]> {
  const result = await database.execute<{
    month: string;
    invoiced: string;
    collected: string;
  }>(sql`
    WITH months AS (
      SELECT (date_trunc('month', ${today}::date)
        - make_interval(months => n))::date AS start
      FROM generate_series(0, ${months - 1}::integer) AS n
    ),
    invoiced AS (
      SELECT date_trunc('month', d.issue_date)::date AS start,
        sum(d.total_cents) AS cents
      FROM document d
      WHERE ${ISSUED_INVOICE(companyId)}
      GROUP BY 1
    ),
    collected AS (
      SELECT date_trunc('month', p.paid_on)::date AS start,
        sum(p.amount_cents) AS cents
      FROM payment p
      JOIN document d ON d.id = p.document_id
      WHERE p.company_id = ${companyId}::uuid
        AND d.document_type = 'invoice'::document_type
        AND d.status = 'issued'::document_status
        AND d.deleted_at IS NULL
      GROUP BY 1
    )
    SELECT to_char(months.start, 'YYYY-MM') AS month,
      coalesce(invoiced.cents, 0)::text AS invoiced,
      coalesce(collected.cents, 0)::text AS collected
    FROM months
    LEFT JOIN invoiced USING (start)
    LEFT JOIN collected USING (start)
    ORDER BY months.start
  `);
  return executionRows<{ month: string; invoiced: string; collected: string }>(
    result,
  ).map((row) => ({
    month: row.month,
    invoicedCents: Number(row.invoiced),
    collectedCents: Number(row.collected),
  }));
}

export interface TopClient {
  clientId: string | null;
  name: string;
  invoicedCents: number;
  invoiceCount: number;
}

export async function topClients(
  companyId: string,
  period: Period,
  limit = 5,
  database: Database = createDatabase(),
): Promise<TopClient[]> {
  const result = await database.execute<{
    client_id: string | null;
    name: string | null;
    cents: string;
    count: string;
  }>(sql`
    SELECT d.client_id, max(c.name) AS name,
      sum(d.total_cents)::text AS cents, count(*)::text AS count
    FROM document d
    LEFT JOIN client c ON c.id = d.client_id AND c.company_id = d.company_id
    WHERE ${ISSUED_INVOICE(companyId)} ${periodFilter(period)}
    GROUP BY d.client_id
    ORDER BY sum(d.total_cents) DESC, d.client_id
    LIMIT ${limit}::integer
  `);
  return executionRows<{
    client_id: string | null;
    name: string | null;
    cents: string;
    count: string;
  }>(result).map((row) => ({
    clientId: row.client_id,
    name: row.name ?? "Sin cliente",
    invoicedCents: Number(row.cents),
    invoiceCount: Number(row.count),
  }));
}

export interface Treasury {
  /** Closing balance of the latest statement of each bank account. */
  balanceCents: number | null;
  balanceOn: string | null;
  /** Pending invoices due from today to today + 30 days. */
  expected30DaysCents: number;
  /** Pending invoices already overdue. */
  overdueCents: number;
}

export async function treasury(
  companyId: string,
  today: string,
  database: Database = createDatabase(),
): Promise<Treasury> {
  const [balance, expected] = await Promise.all([
    database.execute<{ cents: string | null; on: string | null }>(sql`
      SELECT sum(latest.closing_balance_cents)::text AS cents,
        max(latest.closing_balance_on)::text AS on
      FROM (
        SELECT DISTINCT ON (s.collection_method_id)
          s.closing_balance_cents, s.closing_balance_on
        FROM bank_statement s
        WHERE s.company_id = ${companyId}::uuid
          AND s.closing_balance_cents IS NOT NULL
        ORDER BY s.collection_method_id, s.closing_balance_on DESC NULLS LAST,
          s.imported_at DESC
      ) latest
    `),
    database.execute<{ expected: string; overdue: string }>(sql`
      WITH pending AS (
        SELECT d.due_date,
          d.total_cents - coalesce((
            SELECT sum(p.amount_cents) FROM payment p WHERE p.document_id = d.id
          ), 0) AS outstanding
        FROM document d
        WHERE ${ISSUED_INVOICE(companyId)}
      )
      SELECT
        coalesce(sum(outstanding) FILTER (
          WHERE due_date >= ${today}::date
            AND due_date <= ${addCalendarDays(today, 30)}::date
        ), 0)::text AS expected,
        coalesce(sum(outstanding) FILTER (WHERE due_date < ${today}::date), 0)::text AS overdue
      FROM pending
      WHERE outstanding > 0
    `),
  ]);
  const [balanceRow] = executionRows<{
    cents: string | null;
    on: string | null;
  }>(balance);
  const [expectedRow] = executionRows<{ expected: string; overdue: string }>(
    expected,
  );
  return {
    balanceCents: balanceRow?.cents == null ? null : Number(balanceRow.cents),
    balanceOn: balanceRow?.on ?? null,
    expected30DaysCents: Number(expectedRow?.expected ?? 0),
    overdueCents: Number(expectedRow?.overdue ?? 0),
  };
}

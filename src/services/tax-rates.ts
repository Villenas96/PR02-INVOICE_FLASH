import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { taxRates } from "@/db/schema/tax-rate";
import { runStatements } from "@/db/transaction";
import { ApiError, ResourceNotFoundError } from "@/lib/api/errors";
import { createUuidV7 } from "@/lib/ids";

export type TaxRateRow = typeof taxRates.$inferSelect;

/** IVA types every company starts with (research R6). */
export const SEEDED_IVA_RATES = ["21.00", "10.00", "4.00", "0.00"] as const;

/**
 * Seeds IVA 21/10/4/0 (21 % by default) for a company that has no tax types
 * yet, e.g. one created after migration 0006. Idempotent under concurrency:
 * the existence check and the unique indexes make repeats a no-op.
 */
export async function ensureTaxRates(
  database: Database,
  companyId: string,
  now = new Date(),
): Promise<void> {
  const nowIso = now.toISOString();
  const values = sql.join(
    SEEDED_IVA_RATES.map(
      (rate) =>
        sql`(${createUuidV7(now.getTime())}::uuid, ${rate}::numeric(5, 2), ${rate === "21.00"}::boolean)`,
    ),
    sql`, `,
  );
  await database.execute(sql`
    INSERT INTO ${taxRates} (id, company_id, name, rate, is_default, created_at, updated_at)
    SELECT seeded.id, ${companyId}, 'IVA', seeded.rate, seeded.is_default, ${nowIso}, ${nowIso}
    FROM (VALUES ${values}) AS seeded(id, rate, is_default)
    WHERE NOT EXISTS (
      SELECT 1 FROM ${taxRates} existing WHERE existing.company_id = ${companyId}
    )
    ON CONFLICT DO NOTHING
  `);
}

export async function listActiveTaxRates(
  database: Database,
  companyId: string,
): Promise<TaxRateRow[]> {
  await ensureTaxRates(database, companyId);
  return database
    .select()
    .from(taxRates)
    .where(and(eq(taxRates.companyId, companyId), isNull(taxRates.archivedAt)))
    .orderBy(asc(taxRates.name), asc(taxRates.rate));
}

export async function getDefaultTaxRate(
  database: Database,
  companyId: string,
): Promise<TaxRateRow | null> {
  const rates = await listActiveTaxRates(database, companyId);
  return rates.find((rate) => rate.isDefault) ?? rates[0] ?? null;
}

/**
 * Makes `taxRateId` the only default among the company's active types. Two
 * statements in one transaction: the partial unique index on the default
 * is checked per row, so clearing must happen before setting.
 */
export async function setDefaultTaxRate(
  database: Database,
  companyId: string,
  taxRateId: string,
  now = new Date(),
): Promise<void> {
  const nowIso = now.toISOString();
  await runStatements(database, [
    sql`
      UPDATE ${taxRates} SET is_default = false, updated_at = ${nowIso}
      WHERE company_id = ${companyId} AND is_default AND id <> ${taxRateId}
    `,
    sql`
      UPDATE ${taxRates} SET is_default = true, updated_at = ${nowIso}
      WHERE company_id = ${companyId} AND id = ${taxRateId}
        AND archived_at IS NULL
    `,
  ]);
}

/** v1 compatibility: `PUT /company {default_tax_rate}` picks an IVA type. */
export async function setDefaultIvaRate(
  database: Database,
  companyId: string,
  rate: string,
): Promise<void> {
  const rates = await listActiveTaxRates(database, companyId);
  let target = rates.find(
    (candidate) => candidate.name === "IVA" && candidate.rate === rate,
  );
  if (!target) {
    const now = new Date();
    [target] = await database
      .insert(taxRates)
      .values({
        id: createUuidV7(now.getTime()),
        companyId,
        name: "IVA",
        rate,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
  }
  if (target) {
    await setDefaultTaxRate(database, companyId, target.id);
  }
}

const RATE_PATTERN = /^\d{1,2}(?:\.\d{1,2})?$/;

export function normalizeRate(value: string | number): string {
  const text = String(value).trim().replace(",", ".");
  if (!RATE_PATTERN.test(text)) {
    throw new ApiError(
      "validation_error",
      400,
      "El porcentaje debe estar entre 0 y 99,99 con dos decimales como máximo.",
      { rate: "Indica un porcentaje entre 0 y 99,99." },
    );
  }
  return Number(text).toFixed(2);
}

function isUniqueViolation(error: unknown): boolean {
  const code =
    (error as { code?: string; cause?: { code?: string } })?.code ??
    (error as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

function duplicateTaxError(): ApiError {
  return new ApiError(
    "conflict",
    409,
    "Ya tienes un impuesto activo con ese nombre y porcentaje.",
  );
}

export async function createTaxRate(
  database: Database,
  companyId: string,
  input: { name: string; rate: string | number; is_default?: boolean },
  now = new Date(),
): Promise<TaxRateRow> {
  await ensureTaxRates(database, companyId, now);
  const id = createUuidV7(now.getTime());
  try {
    await database.insert(taxRates).values({
      id,
      companyId,
      name: input.name.trim(),
      rate: normalizeRate(input.rate),
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw duplicateTaxError();
    }
    throw error;
  }
  if (input.is_default) {
    await setDefaultTaxRate(database, companyId, id, now);
  }
  return loadTaxRate(database, companyId, id);
}

async function loadTaxRate(
  database: Database,
  companyId: string,
  id: string,
): Promise<TaxRateRow> {
  const [row] = await database
    .select()
    .from(taxRates)
    .where(and(eq(taxRates.id, id), eq(taxRates.companyId, companyId)))
    .limit(1);
  if (!row) {
    throw new ResourceNotFoundError();
  }
  return row;
}

/**
 * Edits a tax type. Issued documents never change: their lines froze name
 * and rate at issue (FR-023). The default type cannot be archived.
 */
export async function updateTaxRate(
  database: Database,
  companyId: string,
  id: string,
  input: {
    name?: string;
    rate?: string | number;
    is_default?: true;
    archived?: boolean;
  },
  now = new Date(),
): Promise<TaxRateRow> {
  const current = await loadTaxRate(database, companyId, id);
  if (input.archived && (current.isDefault || input.is_default)) {
    throw new ApiError(
      "conflict",
      409,
      "No puedes archivar el impuesto predeterminado. Elige antes otro.",
    );
  }
  try {
    await database
      .update(taxRates)
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.rate !== undefined
          ? { rate: normalizeRate(input.rate) }
          : {}),
        ...(input.archived !== undefined
          ? { archivedAt: input.archived ? now : null }
          : {}),
        updatedAt: now,
      })
      .where(and(eq(taxRates.id, id), eq(taxRates.companyId, companyId)));
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw duplicateTaxError();
    }
    throw error;
  }
  if (input.is_default) {
    await setDefaultTaxRate(database, companyId, id, now);
  }
  return loadTaxRate(database, companyId, id);
}

export function taxRateResponse(row: TaxRateRow) {
  return {
    id: row.id,
    name: row.name,
    rate: row.rate,
    is_default: row.isDefault,
    archived_at: row.archivedAt,
  };
}

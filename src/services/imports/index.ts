import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { createDatabase, type Database } from "@/db";
import { firstExecutionRow } from "@/db/result";
import { catalogItems } from "@/db/schema/catalog-item";
import { importJobs } from "@/db/schema/import-job";
import { ApiError } from "@/lib/api/errors";
import { decodeCsvBytes } from "@/lib/csv/decode";
import { CsvTooLargeError, MAX_IMPORT_BYTES, parseCsv } from "@/lib/csv/detect";
import {
  CATALOG_IMPORT_FIELDS,
  type CatalogMapping,
  missingRequiredFields,
  suggestCatalogMapping,
} from "@/lib/csv/map-columns";
import {
  type CatalogRowError,
  type CatalogRowValue,
  normalizeDescription,
  validateCatalogRow,
} from "@/lib/csv/validate-catalog-row";
import { createUuidV7 } from "@/lib/ids";
import type { Plan } from "@/lib/plan";
import { ResourceNotFoundError } from "@/services/context";
import { requireFeature } from "@/services/entitlements";
import { createNotification } from "@/services/notifications";
import type { PrivateBucket } from "@/services/storage";
import { analyzeBankStatement, applyBankStatement } from "../bank/import";
import {
  finishWith,
  type ImportJobDependencies,
  importObjectKey,
  importTooLargeError,
  type JobsQueue,
  readImportFile,
} from "./shared";

export type { ImportJobDependencies, JobsQueue };
export { importObjectKey, importTooLargeError };

import { listActiveTaxRates } from "@/services/tax-rates";
import {
  createImportAnalyzeMessage,
  createImportApplyMessage,
} from "@/workers/messages";

export const APPLY_BATCH_SIZE = 500;
const PREVIEW_SAMPLE_ROWS = 50;
const MAX_REPORTED_ERRORS = 500;

export interface ImportPreview {
  headers: string[];
  encoding: string;
  delimiter: string;
  suggested_mapping: CatalogMapping;
  missing_fields: string[];
  summary: { rows: number; valid: number; errored: number; duplicates: number };
  /** First rows as raw cells, so the wizard can re-check another mapping. */
  sample: string[][];
  errors: CatalogRowError[];
}

export interface ImportResult {
  next_row: number;
  created: number;
  updated: number;
  skipped: number;
  errored: number;
  errors: CatalogRowError[];
}

// ---------------------------------------------------------------- upload ---

/** Stores the file privately and queues its analysis; nothing is created. */
export async function createCatalogImport(input: {
  database?: Database;
  bucket: PrivateBucket;
  queue: JobsQueue;
  companyId: string;
  plan: Plan;
  file: File;
  now?: Date;
}): Promise<{ id: string }> {
  requireFeature({ plan: input.plan }, "catalog_import");
  if (input.file.size > MAX_IMPORT_BYTES) {
    throw importTooLargeError();
  }
  const database = input.database ?? createDatabase();
  const now = input.now ?? new Date();
  const id = createUuidV7(now.getTime());
  const fileKey = importObjectKey(input.companyId, id);
  await input.bucket.put(
    fileKey,
    new Uint8Array(await input.file.arrayBuffer()),
    { httpMetadata: { contentType: "text/csv" } },
  );
  await database.insert(importJobs).values({
    id,
    companyId: input.companyId,
    kind: "catalog",
    fileKey,
    status: "uploaded",
    createdAt: now,
    updatedAt: now,
  });
  await input.queue.send(createImportAnalyzeMessage(id, now));
  return { id };
}

export async function getImport(
  database: Database,
  companyId: string,
  importId: string,
) {
  const [job] = await database
    .select()
    .from(importJobs)
    .where(
      and(eq(importJobs.id, importId), eq(importJobs.companyId, companyId)),
    )
    .limit(1);
  if (!job) {
    throw new ResourceNotFoundError();
  }
  return job;
}

// --------------------------------------------------------------- confirm ---

export const confirmImportSchema = z
  .object({
    mapping: z
      .object(
        Object.fromEntries(
          CATALOG_IMPORT_FIELDS.map((field) => [
            field,
            z.number().int().min(0).nullable(),
          ]),
        ) as Record<
          (typeof CATALOG_IMPORT_FIELDS)[number],
          z.ZodNullable<z.ZodNumber>
        >,
      )
      .strict(),
    duplicate_policy: z.enum(["skip", "update"]),
  })
  .strict();

/** Starts the apply job; only from `preview_ready` (FR-031). */
export async function confirmImport(input: {
  database?: Database;
  queue: JobsQueue;
  companyId: string;
  plan: Plan;
  importId: string;
  mapping: CatalogMapping;
  duplicatePolicy: "skip" | "update";
  now?: Date;
}): Promise<void> {
  requireFeature({ plan: input.plan }, "catalog_import");
  const database = input.database ?? createDatabase();
  const now = input.now ?? new Date();
  const job = await getImport(database, input.companyId, input.importId);
  const preview = job.preview as ImportPreview | null;
  if (job.status !== "preview_ready" || !preview) {
    throw new ApiError(
      "conflict",
      409,
      "La importación no está lista para confirmarse.",
    );
  }
  const columns = preview.headers.length;
  const outOfRange = Object.values(input.mapping).some(
    (index) => index !== null && index >= columns,
  );
  const indexes = Object.values(input.mapping).filter(
    (index): index is number => index !== null,
  );
  const missing = missingRequiredFields(input.mapping);
  if (
    outOfRange ||
    new Set(indexes).size !== indexes.length ||
    missing.length
  ) {
    throw new ApiError(
      "validation_error",
      400,
      "Asigna una columna distinta a la descripción y al precio.",
      { mapping: "Revisa la correspondencia de columnas." },
    );
  }

  const initial: ImportResult = {
    next_row: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errored: 0,
    errors: [],
  };
  const [claimed] = await database
    .update(importJobs)
    .set({
      status: "applying",
      mapping: input.mapping,
      duplicatePolicy: input.duplicatePolicy,
      result: initial,
      updatedAt: now,
    })
    .where(
      and(eq(importJobs.id, job.id), eq(importJobs.status, "preview_ready")),
    )
    .returning({ id: importJobs.id });
  if (!claimed) {
    throw new ApiError(
      "conflict",
      409,
      "La importación no está lista para confirmarse.",
    );
  }
  await input.queue.send(createImportApplyMessage(job.id, now));
}

// ------------------------------------------------------------ job helpers ---

async function activeCatalogKeys(
  database: Database,
  companyId: string,
): Promise<Map<string, string>> {
  const rows = await database
    .select({ id: catalogItems.id, description: catalogItems.description })
    .from(catalogItems)
    .where(
      and(
        eq(catalogItems.companyId, companyId),
        isNull(catalogItems.archivedAt),
      ),
    );
  return new Map(
    rows.map((row) => [normalizeDescription(row.description), row.id]),
  );
}

// --------------------------------------------------------------- analyze ---

/**
 * `import.analyze`: validates the whole file with the suggested mapping and
 * stores a preview. It never creates catalog items.
 */
export async function analyzeImport(
  importId: string,
  dependencies: ImportJobDependencies,
): Promise<void> {
  const database = dependencies.database ?? createDatabase();
  const now = dependencies.now ?? new Date();
  const [job] = await database
    .update(importJobs)
    .set({ status: "analyzing", updatedAt: now })
    .where(
      and(
        eq(importJobs.id, importId),
        sql`${importJobs.status} IN ('uploaded', 'analyzing')`,
      ),
    )
    .returning();
  if (!job) {
    return;
  }
  if (job.kind === "bank_statement") {
    return analyzeBankStatement(job, dependencies, now);
  }

  const bytes = await readImportFile(dependencies.bucket, job.fileKey);
  if (!bytes) {
    await finishWith(
      database,
      job.id,
      { status: "failed", errorCode: "file_missing" },
      now,
    );
    return;
  }
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    await finishWith(
      database,
      job.id,
      { status: "rejected", errorCode: "import_too_large" },
      now,
    );
    return;
  }

  const decoded = decodeCsvBytes(bytes);
  let parsed: ReturnType<typeof parseCsv>;
  try {
    parsed = parseCsv(decoded.text);
  } catch (error) {
    await finishWith(
      database,
      job.id,
      {
        status: "rejected",
        errorCode:
          error instanceof CsvTooLargeError
            ? "import_too_large"
            : "csv_invalid",
        rowCount: error instanceof CsvTooLargeError ? error.rowCount : null,
      },
      now,
    );
    return;
  }

  const mapping = suggestCatalogMapping(parsed.headers);
  const missing = missingRequiredFields(mapping);
  const existing = await activeCatalogKeys(database, job.companyId);
  const seen = new Set<string>();
  const errors: CatalogRowError[] = [];
  let valid = 0;
  let errored = 0;
  let duplicates = 0;
  if (missing.length === 0) {
    parsed.rows.forEach((row, index) => {
      const result = validateCatalogRow(row, mapping, index + 2);
      if (!result.ok) {
        errored += 1;
        errors.push(...result.errors);
        return;
      }
      valid += 1;
      const key = normalizeDescription(result.value.description);
      if (existing.has(key) || seen.has(key)) {
        duplicates += 1;
      }
      seen.add(key);
    });
  }

  const preview: ImportPreview = {
    headers: parsed.headers,
    encoding: decoded.encoding,
    delimiter: parsed.delimiter,
    suggested_mapping: mapping,
    missing_fields: missing,
    summary: { rows: parsed.rows.length, valid, errored, duplicates },
    sample: parsed.rows.slice(0, PREVIEW_SAMPLE_ROWS),
    errors: errors.slice(0, MAX_REPORTED_ERRORS),
  };
  await finishWith(
    database,
    job.id,
    { status: "preview_ready", preview, rowCount: parsed.rows.length },
    now,
  );
  await createNotification({
    database,
    companyId: job.companyId,
    kind: "import_ready",
    payload: { import_id: job.id, rows: parsed.rows.length },
    idempotencyKey: `import_ready:${job.id}`,
    now,
  });
}

// ----------------------------------------------------------------- apply ---

interface TaxChoice {
  rate: string;
  id: string | null;
}

async function taxResolver(
  database: Database,
  companyId: string,
): Promise<(rate: string | null) => TaxChoice> {
  const rates = await listActiveTaxRates(database, companyId);
  const fallback = rates.find((rate) => rate.isDefault) ?? rates[0];
  return (rate) => {
    if (rate === null) {
      return { rate: fallback?.rate ?? "21.00", id: fallback?.id ?? null };
    }
    const match =
      rates.find(
        (candidate) => candidate.rate === rate && candidate.name === "IVA",
      ) ?? rates.find((candidate) => candidate.rate === rate);
    return { rate, id: match?.id ?? null };
  };
}

interface PlannedRow {
  id: string;
  description: string;
  unit_price_cents: number;
  tax_rate: string;
  tax_rate_id: string | null;
  unit: string | null;
}

/**
 * Applies one batch atomically together with the job's progress. The
 * progress guard (`next_row` = what this delivery read) makes a concurrent
 * or redelivered message claim nothing, so rows are never created twice.
 */
async function applyBatch(
  database: Database,
  input: {
    importId: string;
    companyId: string;
    expectedNextRow: number;
    result: ImportResult;
    inserts: PlannedRow[];
    updates: PlannedRow[];
    now: Date;
  },
): Promise<boolean> {
  const nowIso = input.now.toISOString();
  const recordset = sql`(
    id uuid, description text, unit_price_cents integer, tax_rate numeric,
    tax_rate_id uuid, unit text
  )`;
  const outcome = await database.execute<{ claimed: number }>(sql`
    WITH claim AS (
      UPDATE ${importJobs}
      SET result = ${JSON.stringify(input.result)}::jsonb, updated_at = ${nowIso}
      WHERE id = ${input.importId}
        AND status = 'applying'
        AND (result ->> 'next_row')::integer = ${input.expectedNextRow}::integer
      RETURNING id
    ),
    inserted AS (
      INSERT INTO ${catalogItems} (
        id, company_id, description, unit_price_cents, tax_rate, tax_rate_id,
        unit, source_import_id, created_at, updated_at
      )
      SELECT row.id, ${input.companyId}, row.description, row.unit_price_cents,
        row.tax_rate, row.tax_rate_id, row.unit, ${input.importId}, ${nowIso},
        ${nowIso}
      FROM jsonb_to_recordset(${JSON.stringify(input.inserts)}::jsonb) AS row ${recordset}
      WHERE EXISTS (SELECT 1 FROM claim)
      RETURNING 1
    ),
    updated AS (
      UPDATE ${catalogItems} item
      SET unit_price_cents = row.unit_price_cents,
        tax_rate = row.tax_rate,
        tax_rate_id = row.tax_rate_id,
        unit = coalesce(row.unit, item.unit),
        source_import_id = ${input.importId},
        updated_at = ${nowIso}
      FROM jsonb_to_recordset(${JSON.stringify(input.updates)}::jsonb) AS row ${recordset}
      WHERE item.id = row.id
        AND item.company_id = ${input.companyId}
        AND EXISTS (SELECT 1 FROM claim)
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM claim)::integer AS claimed,
      (SELECT count(*) FROM inserted) AS inserted_count,
      (SELECT count(*) FROM updated) AS updated_count
  `);
  return (firstExecutionRow<{ claimed: number }>(outcome)?.claimed ?? 0) > 0;
}

/**
 * `import.apply`: creates or updates catalog items in batches of 500, each
 * in its own transaction with the progress, and resumes after a crash or
 * redelivery from the last committed batch.
 */
export async function applyImport(
  importId: string,
  dependencies: ImportJobDependencies,
): Promise<void> {
  const database = dependencies.database ?? createDatabase();
  const now = dependencies.now ?? new Date();
  const [job] = await database
    .select()
    .from(importJobs)
    .where(and(eq(importJobs.id, importId), eq(importJobs.status, "applying")))
    .limit(1);
  if (!job) {
    return;
  }
  if (job.kind === "bank_statement") {
    return applyBankStatement(job, dependencies, now);
  }
  const mapping = job.mapping as CatalogMapping;
  const policy = job.duplicatePolicy ?? "skip";
  let result = job.result as ImportResult;

  const bytes = await readImportFile(dependencies.bucket, job.fileKey);
  if (!bytes) {
    await finishWith(
      database,
      job.id,
      { status: "failed", errorCode: "file_missing" },
      now,
    );
    return;
  }
  const { rows } = parseCsv(decodeCsvBytes(bytes).text);
  const existing = await activeCatalogKeys(database, job.companyId);
  const resolveTax = await taxResolver(database, job.companyId);

  while (result.next_row < rows.length) {
    const start = result.next_row;
    const end = Math.min(start + APPLY_BATCH_SIZE, rows.length);
    const next: ImportResult = { ...result, errors: [...result.errors] };
    const inserts: PlannedRow[] = [];
    const updates = new Map<string, PlannedRow>();
    const pendingKeys = new Map<string, string>();

    for (let index = start; index < end; index += 1) {
      const validated = validateCatalogRow(
        rows[index] ?? [],
        mapping,
        index + 2,
      );
      if (!validated.ok) {
        next.errored += 1;
        if (next.errors.length < MAX_REPORTED_ERRORS) {
          next.errors.push(
            ...validated.errors.slice(
              0,
              MAX_REPORTED_ERRORS - next.errors.length,
            ),
          );
        }
        continue;
      }
      const value: CatalogRowValue = validated.value;
      const key = normalizeDescription(value.description);
      const tax = resolveTax(value.taxRate);
      const existingId = existing.get(key) ?? pendingKeys.get(key);
      if (existingId) {
        if (policy === "skip") {
          next.skipped += 1;
          continue;
        }
        const planned: PlannedRow = {
          id: existingId,
          description: value.description,
          unit_price_cents: value.unitPriceCents,
          tax_rate: tax.rate,
          tax_rate_id: tax.id,
          unit: value.unit,
        };
        const pendingInsert = inserts.find((row) => row.id === existingId);
        if (pendingInsert) {
          Object.assign(pendingInsert, planned);
        } else {
          updates.set(existingId, planned);
        }
        next.updated += 1;
        continue;
      }
      const id = createUuidV7(now.getTime());
      inserts.push({
        id,
        description: value.description,
        unit_price_cents: value.unitPriceCents,
        tax_rate: tax.rate,
        tax_rate_id: tax.id,
        unit: value.unit,
      });
      pendingKeys.set(key, id);
      next.created += 1;
    }
    next.next_row = end;

    const claimed = await applyBatch(database, {
      importId: job.id,
      companyId: job.companyId,
      expectedNextRow: start,
      result: next,
      inserts,
      updates: [...updates.values()],
      now,
    });
    if (!claimed) {
      // Another delivery is applying this import; it will finish the job.
      return;
    }
    for (const [key, id] of pendingKeys) {
      existing.set(key, id);
    }
    result = next;
  }

  const [finished] = await database
    .update(importJobs)
    .set({ status: "done", updatedAt: now })
    .where(and(eq(importJobs.id, job.id), eq(importJobs.status, "applying")))
    .returning({ id: importJobs.id });
  if (finished) {
    await createNotification({
      database,
      companyId: job.companyId,
      kind: "import_done",
      payload: {
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        errored: result.errored,
      },
      idempotencyKey: `import_done:${job.id}`,
      now,
    });
  }
}

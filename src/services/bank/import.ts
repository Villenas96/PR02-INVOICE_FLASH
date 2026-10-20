import { and, count, eq, inArray, sql } from "drizzle-orm";
import { read, utils } from "xlsx";
import { z } from "zod";

import { createDatabase, type Database } from "@/db";
import { bankStatements } from "@/db/schema/bank-statement";
import { bankTransactions } from "@/db/schema/bank-transaction";
import { collectionMethods } from "@/db/schema/collection-method";
import { importJobs } from "@/db/schema/import-job";
import { ApiError } from "@/lib/api/errors";
import {
  BANK_FIELDS,
  type BankMapping,
  type BankRowError,
  missingBankFields,
  readCsvStatement,
  suggestBankMapping,
} from "@/lib/bank/csv-statement";
import { withOccurrences } from "@/lib/bank/fingerprint";
import {
  decodeNorma43,
  Norma43Error,
  type Norma43Movement,
  parseNorma43,
} from "@/lib/bank/norma43";
import { decodeCsvBytes } from "@/lib/csv/decode";
import { CsvTooLargeError, MAX_IMPORT_BYTES, parseCsv } from "@/lib/csv/detect";
import { createUuidV7 } from "@/lib/ids";
import type { Plan } from "@/lib/plan";
import { ResourceNotFoundError } from "@/services/context";
import { requireFeature } from "@/services/entitlements";
import { createNotification } from "@/services/notifications";
import type { PrivateBucket } from "@/services/storage";
import {
  createImportAnalyzeMessage,
  createImportApplyMessage,
} from "@/workers/messages";

import {
  finishWith,
  type ImportJobDependencies,
  importObjectKey,
  importTooLargeError,
  type JobsQueue,
  readImportFile,
} from "../imports/shared";

const PREVIEW_SAMPLE_ROWS = 50;
const MAX_REPORTED_ERRORS = 500;
const INSERT_BATCH = 500;

type Format = "norma43" | "csv" | "xlsx";

interface ParsedStatement {
  format: Format;
  account: string;
  periodStart: string | null;
  periodEnd: string | null;
  closingBalanceCents: number | null;
  closingBalanceOn: string | null;
  movements: Norma43Movement[];
  errors: BankRowError[];
  /** CSV only: headers, suggested mapping and the raw rows. */
  headers?: string[];
  mapping?: BankMapping;
  rows?: string[][];
}

export interface BankPreview {
  format: Format;
  account: string;
  period: { start: string | null; end: string | null };
  closing_balance_cents: number | null;
  headers: string[];
  suggested_mapping: BankMapping | null;
  missing_fields: string[];
  summary: {
    movements: number;
    credits: number;
    debits: number;
    new_movements: number;
    duplicates: number;
    errored: number;
  };
  sample: Array<{
    operation_on: string;
    concept: string;
    amount_cents: number;
  }>;
  errors: BankRowError[];
}

export interface BankResult {
  created: number;
  duplicates: number;
}

export const confirmBankImportSchema = z
  .object({
    mapping: z
      .object(
        Object.fromEntries(
          BANK_FIELDS.map((field) => [
            field,
            z.number().int().min(0).nullable(),
          ]),
        ) as Record<(typeof BANK_FIELDS)[number], z.ZodNullable<z.ZodNumber>>,
      )
      .strict()
      .optional(),
  })
  .strict();

function bankError(message: string): ApiError {
  return new ApiError("validation_error", 400, message, {
    collection_method_id: message,
  });
}

// ---------------------------------------------------------------- upload ---

/** Stores the statement and queues its analysis; nothing is imported yet. */
export async function createBankImport(input: {
  database?: Database;
  bucket: PrivateBucket;
  queue: JobsQueue;
  companyId: string;
  plan: Plan;
  file: File;
  collectionMethodId: string;
  now?: Date;
}): Promise<{ id: string }> {
  requireFeature({ plan: input.plan }, "bank_reconciliation");
  if (input.file.size > MAX_IMPORT_BYTES) {
    throw importTooLargeError();
  }
  const database = input.database ?? createDatabase();
  const now = input.now ?? new Date();
  const [method] = await database
    .select({ kind: collectionMethods.kind })
    .from(collectionMethods)
    .where(
      and(
        eq(collectionMethods.id, input.collectionMethodId),
        eq(collectionMethods.companyId, input.companyId),
      ),
    );
  if (!method) {
    throw new ResourceNotFoundError();
  }
  if (method.kind !== "bank_account") {
    throw bankError("Elige una cuenta bancaria como método de cobro.");
  }
  const id = createUuidV7(now.getTime());
  const fileKey = importObjectKey(input.companyId, id, "statement");
  await input.bucket.put(
    fileKey,
    new Uint8Array(await input.file.arrayBuffer()),
    { httpMetadata: { contentType: "application/octet-stream" } },
  );
  await database.insert(importJobs).values({
    id,
    companyId: input.companyId,
    kind: "bank_statement",
    fileKey,
    status: "uploaded",
    mapping: { collection_method_id: input.collectionMethodId },
    createdAt: now,
    updatedAt: now,
  });
  await input.queue.send(createImportAnalyzeMessage(id, now));
  return { id };
}

// --------------------------------------------------------------- parsing ---

function looksLikeNorma43(text: string): boolean {
  return /^11\d{4}\d{4}\d{10}/.test(text.trimStart());
}

function csvFromXlsx(bytes: Uint8Array): string {
  const workbook = read(bytes);
  const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
  if (!sheet) {
    throw new Error("El libro no tiene hojas.");
  }
  return utils.sheet_to_csv(sheet, { FS: ";", blankrows: false });
}

function parseStatement(
  bytes: Uint8Array,
  csvMapping: BankMapping | null,
): ParsedStatement {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const latin = decodeNorma43(bytes);
  if (!isZip && looksLikeNorma43(latin)) {
    const account = parseNorma43(latin).accounts[0];
    if (!account) {
      throw new Norma43Error("El fichero no contiene ninguna cuenta.", 1);
    }
    return {
      format: "norma43",
      account: `${account.entity}-${account.office}-${account.number}`,
      periodStart: account.periodStart,
      periodEnd: account.periodEnd,
      closingBalanceCents: account.closingBalanceCents,
      closingBalanceOn: account.periodEnd,
      movements: account.movements,
      errors: [],
    };
  }
  const text = isZip ? csvFromXlsx(bytes) : decodeCsvBytes(bytes).text;
  const { headers, rows } = parseCsv(text);
  const mapping = csvMapping ?? suggestBankMapping(headers);
  const missing = missingBankFields(mapping);
  const statement =
    missing.length === 0
      ? readCsvStatement(rows, mapping)
      : {
          movements: [],
          errors: [],
          closingBalanceCents: null,
          closingBalanceOn: null,
          periodStart: null,
          periodEnd: null,
        };
  return {
    format: isZip ? "xlsx" : "csv",
    account: "csv",
    headers,
    mapping,
    rows,
    ...statement,
  };
}

/** `entity-office-number` of a Spanish IBAN, to check the right account. */
function ibanAccount(iban: string | null): string | null {
  const compact = iban?.replace(/\s/g, "").toUpperCase() ?? "";
  if (!/^ES\d{22}$/.test(compact)) {
    return null;
  }
  return `${compact.slice(4, 8)}-${compact.slice(8, 12)}-${compact.slice(14, 24)}`;
}

async function methodOf(database: Database, companyId: string, id: string) {
  const [method] = await database
    .select({ id: collectionMethods.id, iban: collectionMethods.iban })
    .from(collectionMethods)
    .where(
      and(
        eq(collectionMethods.id, id),
        eq(collectionMethods.companyId, companyId),
      ),
    );
  return method ?? null;
}

async function knownFingerprints(
  database: Database,
  methodId: string,
  rows: Array<{ fingerprint: string; occurrence: number }>,
): Promise<Set<string>> {
  const known = new Set<string>();
  const fingerprints = [...new Set(rows.map((row) => row.fingerprint))];
  for (let offset = 0; offset < fingerprints.length; offset += 1_000) {
    const found = await database
      .select({
        fingerprint: bankTransactions.fingerprint,
        occurrence: bankTransactions.occurrence,
      })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.collectionMethodId, methodId),
          inArray(
            bankTransactions.fingerprint,
            fingerprints.slice(offset, offset + 1_000),
          ),
        ),
      );
    for (const row of found) {
      known.add(`${row.fingerprint}:${row.occurrence}`);
    }
  }
  return known;
}

// --------------------------------------------------------------- analyze ---

/** `import.analyze` for a bank statement: preview only, nothing is stored. */
export async function analyzeBankStatement(
  job: typeof importJobs.$inferSelect,
  dependencies: ImportJobDependencies,
  now: Date,
): Promise<void> {
  const database = dependencies.database ?? createDatabase();
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
  const methodId = (job.mapping as { collection_method_id?: string } | null)
    ?.collection_method_id;
  const method = methodId
    ? await methodOf(database, job.companyId, methodId)
    : null;
  if (!method) {
    await finishWith(
      database,
      job.id,
      { status: "failed", errorCode: "method_missing" },
      now,
    );
    return;
  }

  let parsed: ParsedStatement;
  try {
    parsed = parseStatement(bytes, null);
  } catch (error) {
    await finishWith(
      database,
      job.id,
      {
        status: "rejected",
        errorCode:
          error instanceof CsvTooLargeError
            ? "import_too_large"
            : error instanceof Norma43Error
              ? "statement_invalid"
              : "csv_invalid",
        preview:
          error instanceof Norma43Error ? { message: error.message } : null,
      },
      now,
    );
    return;
  }
  const expectedAccount = ibanAccount(method.iban);
  if (
    parsed.format === "norma43" &&
    expectedAccount &&
    parsed.account !== expectedAccount
  ) {
    await finishWith(
      database,
      job.id,
      { status: "rejected", errorCode: "account_mismatch" },
      now,
    );
    return;
  }

  const withFingerprints = await withOccurrences(
    parsed.movements.map((movement) => ({
      ...movement,
      account: parsed.account,
    })),
  );
  const known = await knownFingerprints(database, method.id, withFingerprints);
  const duplicates = withFingerprints.filter((row) =>
    known.has(`${row.fingerprint}:${row.occurrence}`),
  ).length;
  const preview: BankPreview = {
    format: parsed.format,
    account: parsed.account,
    period: { start: parsed.periodStart, end: parsed.periodEnd },
    closing_balance_cents: parsed.closingBalanceCents,
    headers: parsed.headers ?? [],
    suggested_mapping: parsed.mapping ?? null,
    missing_fields: parsed.mapping ? missingBankFields(parsed.mapping) : [],
    summary: {
      movements: parsed.movements.length,
      credits: parsed.movements.filter((movement) => movement.amountCents > 0)
        .length,
      debits: parsed.movements.filter((movement) => movement.amountCents < 0)
        .length,
      new_movements: parsed.movements.length - duplicates,
      duplicates,
      errored: parsed.errors.length,
    },
    sample: parsed.movements.slice(0, PREVIEW_SAMPLE_ROWS).map((movement) => ({
      operation_on: movement.operationOn,
      concept: movement.concept,
      amount_cents: movement.amountCents,
    })),
    errors: parsed.errors.slice(0, MAX_REPORTED_ERRORS),
  };
  await finishWith(
    database,
    job.id,
    { status: "preview_ready", preview, rowCount: parsed.movements.length },
    now,
  );
  await createNotification({
    database,
    companyId: job.companyId,
    kind: "import_ready",
    payload: { import_id: job.id, rows: parsed.movements.length },
    idempotencyKey: `import_ready:${job.id}`,
    now,
  });
}

// --------------------------------------------------------------- confirm ---

export async function confirmBankImport(input: {
  database?: Database;
  queue: JobsQueue;
  companyId: string;
  plan: Plan;
  job: typeof importJobs.$inferSelect;
  mapping?: BankMapping;
  now?: Date;
}): Promise<void> {
  requireFeature({ plan: input.plan }, "bank_reconciliation");
  const database = input.database ?? createDatabase();
  const now = input.now ?? new Date();
  const preview = input.job.preview as BankPreview | null;
  if (input.job.status !== "preview_ready" || !preview) {
    throw new ApiError(
      "conflict",
      409,
      "La importación no está lista para confirmarse.",
    );
  }
  let stored: Record<string, unknown> = {
    ...(input.job.mapping as Record<string, unknown>),
  };
  if (preview.format !== "norma43") {
    const mapping = input.mapping ?? preview.suggested_mapping;
    const indexes = mapping
      ? Object.values(mapping).filter(
          (index): index is number => index !== null,
        )
      : [];
    if (
      !mapping ||
      missingBankFields(mapping).length > 0 ||
      new Set(indexes).size !== indexes.length ||
      indexes.some((index) => index >= preview.headers.length)
    ) {
      throw new ApiError(
        "validation_error",
        400,
        "Asigna una columna distinta a la fecha, el concepto y el importe.",
        { mapping: "Revisa la correspondencia de columnas." },
      );
    }
    stored = { ...stored, columns: mapping };
  }
  const [claimed] = await database
    .update(importJobs)
    .set({ status: "applying", mapping: stored, updatedAt: now })
    .where(
      and(
        eq(importJobs.id, input.job.id),
        eq(importJobs.status, "preview_ready"),
      ),
    )
    .returning({ id: importJobs.id });
  if (!claimed) {
    throw new ApiError(
      "conflict",
      409,
      "La importación no está lista para confirmarse.",
    );
  }
  await input.queue.send(createImportApplyMessage(input.job.id, now));
}

// ----------------------------------------------------------------- apply ---

/**
 * `import.apply` for a bank statement. Idempotent: the statement id is the
 * job id and movements are inserted `ON CONFLICT DO NOTHING` on the unique
 * `(method, fingerprint, occurrence)`, so redeliveries and overlapping
 * statements add nothing twice. The result counts what this statement
 * brought, read back from the database.
 */
export async function applyBankStatement(
  job: typeof importJobs.$inferSelect,
  dependencies: ImportJobDependencies,
  now: Date,
): Promise<void> {
  const database = dependencies.database ?? createDatabase();
  const stored = job.mapping as {
    collection_method_id: string;
    columns?: BankMapping;
  };
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
  const parsed = parseStatement(bytes, stored.columns ?? null);
  const rows = await withOccurrences(
    parsed.movements.map((movement) => ({
      ...movement,
      account: parsed.account,
    })),
  );

  await database
    .insert(bankStatements)
    .values({
      id: job.id,
      companyId: job.companyId,
      collectionMethodId: stored.collection_method_id,
      format: parsed.format,
      fileKey: job.fileKey,
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
      closingBalanceCents: parsed.closingBalanceCents,
      closingBalanceOn: parsed.closingBalanceOn,
      importJobId: job.id,
      importedAt: now,
    })
    .onConflictDoNothing();

  for (let offset = 0; offset < rows.length; offset += INSERT_BATCH) {
    await database
      .insert(bankTransactions)
      .values(
        rows.slice(offset, offset + INSERT_BATCH).map((row) => ({
          id: createUuidV7(now.getTime()),
          companyId: job.companyId,
          collectionMethodId: stored.collection_method_id,
          statementId: job.id,
          operationOn: row.operationOn,
          valueOn: row.valueOn,
          amountCents: row.amountCents,
          concept: row.concept,
          reference: row.reference,
          fingerprint: row.fingerprint,
          occurrence: row.occurrence,
          createdAt: now,
        })),
      )
      .onConflictDoNothing();
  }

  const [brought] = await database
    .select({ value: count() })
    .from(bankTransactions)
    .where(eq(bankTransactions.statementId, job.id));
  const created = brought?.value ?? 0;
  const result: BankResult = { created, duplicates: rows.length - created };
  await database
    .update(importJobs)
    .set({ status: "done", result, updatedAt: now })
    .where(
      and(eq(importJobs.id, job.id), sql`${importJobs.status} = 'applying'`),
    );
  await createNotification({
    database,
    companyId: job.companyId,
    kind: "import_done",
    payload: {
      created: result.created,
      updated: 0,
      skipped: result.duplicates,
      errored: parsed.errors.length,
    },
    idempotencyKey: `import_done:${job.id}`,
    now,
  });
}

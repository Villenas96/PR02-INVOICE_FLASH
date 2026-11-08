import { and, count, eq, gte, isNull, lt } from "drizzle-orm";

import { createDatabase, type Database } from "@/db";
import { collectionMethods } from "@/db/schema/collection-method";
import { companies } from "@/db/schema/company";
import { sampleRenders } from "@/db/schema/sample-render";
import { ApiError } from "@/lib/api/errors";
import { getCompanyReadiness } from "@/lib/documents";
import { logSafe } from "@/lib/log";
import {
  applyOnboardingUpdate,
  deriveOnboarding,
  type OnboardingProgress,
  type OnboardingUpdate,
  parseOnboardingState,
} from "@/lib/onboarding";
import type { CompanyContext } from "@/services/context";
import { ResourceNotFoundError } from "@/services/context";
import {
  type PdfAssets,
  type PdfLogoAsset,
  renderDocumentPdf,
} from "@/services/pdf/render";
import type { DocumentPdfInput } from "@/services/pdf/template";
import type { PrivateBucket } from "@/services/storage";
import { createPdfSampleMessage } from "@/workers/messages";

export const SAMPLE_WATERMARK = "EJEMPLO – sin validez";
export const SAMPLE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** Samples a company may generate per hour (it is a render job each). */
const SAMPLES_PER_HOUR = 10;

type CompanyRow = typeof companies.$inferSelect;

export function sampleObjectKey(companyId: string, sampleId: string): string {
  return `samples/${companyId}/${sampleId}.pdf`;
}

async function hasCollectionMethod(
  database: Database,
  companyId: string,
): Promise<boolean> {
  const [row] = await database
    .select({ id: collectionMethods.id })
    .from(collectionMethods)
    .where(
      and(
        eq(collectionMethods.companyId, companyId),
        isNull(collectionMethods.archivedAt),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function onboardingProgressFor(
  database: Database,
  company: CompanyRow,
): Promise<OnboardingProgress> {
  return deriveOnboarding(parseOnboardingState(company.onboarding), {
    fiscalDataComplete: getCompanyReadiness(company).ready,
    hasLogo: company.logoKey !== null,
    hasCollectionMethod: await hasCollectionMethod(database, company.id),
  });
}

async function loadCompany(
  database: Database,
  companyId: string,
): Promise<CompanyRow> {
  const [company] = await database
    .select()
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (!company) {
    throw new ResourceNotFoundError();
  }
  return company;
}

export async function getOnboarding(
  context: CompanyContext,
  database: Database = createDatabase(),
): Promise<OnboardingProgress> {
  return onboardingProgressFor(
    database,
    await loadCompany(database, context.companyId),
  );
}

/** Records one wizard action. Idempotent; never touches the company's data. */
export async function updateOnboarding(
  context: CompanyContext,
  update: OnboardingUpdate,
  database: Database = createDatabase(),
  now = new Date(),
): Promise<OnboardingProgress> {
  const company = await loadCompany(database, context.companyId);
  const next = applyOnboardingUpdate(
    parseOnboardingState(company.onboarding),
    update,
    now,
  );
  const [updated] = await database
    .update(companies)
    .set({ onboarding: next, updatedAt: now })
    .where(eq(companies.id, company.id))
    .returning();
  return onboardingProgressFor(database, updated ?? company);
}

export interface QueueProducer {
  send(message: unknown): Promise<void>;
}

/**
 * Queues a watermarked sample PDF. It creates only a `sample_render` row:
 * never a document, a number or quota usage (FR-049).
 */
export async function requestSample(input: {
  context: CompanyContext;
  queue: QueueProducer;
  database?: Database;
  now?: Date;
}): Promise<{ sampleId: string }> {
  const database = input.database ?? createDatabase();
  const now = input.now ?? new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const [recent] = await database
    .select({ total: count() })
    .from(sampleRenders)
    .where(
      and(
        eq(sampleRenders.companyId, input.context.companyId),
        gte(sampleRenders.createdAt, hourAgo),
      ),
    );
  if ((recent?.total ?? 0) >= SAMPLES_PER_HOUR) {
    throw new ApiError(
      "conflict",
      409,
      "Has generado demasiados ejemplos. Inténtalo en un rato.",
    );
  }
  const sampleId = crypto.randomUUID();
  await database.insert(sampleRenders).values({
    id: sampleId,
    companyId: input.context.companyId,
    status: "pending",
    createdAt: now,
  });
  await input.queue.send(createPdfSampleMessage(sampleId, now));
  return { sampleId };
}

export async function getSample(
  context: CompanyContext,
  sampleId: string,
  database: Database = createDatabase(),
): Promise<typeof sampleRenders.$inferSelect> {
  const [sample] = await database
    .select()
    .from(sampleRenders)
    .where(
      and(
        eq(sampleRenders.id, sampleId),
        eq(sampleRenders.companyId, context.companyId),
      ),
    )
    .limit(1);
  if (!sample) {
    throw new ResourceNotFoundError();
  }
  return sample;
}

/** Fixed, plausible content: the company's own header on dummy lines. */
export function buildSampleInput(
  company: CompanyRow,
  now: Date,
): DocumentPdfInput {
  const line = (
    position: number,
    description: string,
    quantity: number,
    unitPriceCents: number,
  ) => {
    const subtotal = quantity * unitPriceCents;
    const tax = Math.round(subtotal * 0.21);
    return {
      position,
      description,
      quantity: String(quantity),
      unitPriceCents,
      taxRate: "21.00",
      lineSubtotalCents: subtotal,
      lineTaxCents: tax,
      lineTotalCents: subtotal + tax,
    };
  };
  const lines = [
    line(1, "Diseño de logotipo", 1, 30_000),
    line(2, "Mantenimiento mensual", 2, 7_500),
  ];
  const subtotal = lines.reduce((sum, item) => sum + item.lineSubtotalCents, 0);
  const tax = lines.reduce((sum, item) => sum + item.lineTaxCents, 0);
  return {
    documentType: "invoice",
    fullNumber: "EJEMPLO-0001",
    issueDate: now.toISOString().slice(0, 10),
    dueDate: null,
    currency: "EUR",
    issuer: {
      legalName: company.legalName?.trim() || "Tu empresa, S.L.",
      taxId: company.taxId?.trim() || "B00000000",
      addressLines: [
        company.address?.trim() || "Calle Ejemplo 1, 28001 Madrid",
      ],
      email: company.email,
    },
    client: {
      legalName: "Cliente de ejemplo, S.L.",
      taxId: "B12345678",
      addressLines: ["Avenida del Cliente 2, 08001 Barcelona"],
    },
    lines,
    subtotalCents: subtotal,
    taxBreakdown: [{ rate: "21.00", baseCents: subtotal, taxCents: tax }],
    retentionRate: "0.00",
    retentionCents: 0,
    totalCents: subtotal + tax,
    notes: null,
    payment: null,
    watermark: SAMPLE_WATERMARK,
  };
}

async function loadLogo(
  bucket: PrivateBucket,
  key: string | null,
): Promise<PdfLogoAsset | null> {
  if (!key || !/\.(png|jpe?g)$/i.test(key)) {
    return null;
  }
  const object = await bucket.get(key);
  if (!object) {
    return null;
  }
  const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
  return { bytes, format: /\.png$/i.test(key) ? "png" : "jpg" };
}

export interface SampleRenderDependencies {
  database?: Database;
  bucket: PrivateBucket;
  renderPdf?: (
    input: DocumentPdfInput,
    assets?: PdfAssets,
  ) => Promise<Uint8Array>;
  now?: () => Date;
}

/** `pdf.sample`: render, store under `samples/` and mark ready. Idempotent. */
export async function renderSample(
  sampleId: string,
  dependencies: SampleRenderDependencies,
): Promise<void> {
  const database = dependencies.database ?? createDatabase();
  const [sample] = await database
    .select()
    .from(sampleRenders)
    .where(eq(sampleRenders.id, sampleId))
    .limit(1);
  if (!sample || sample.status !== "pending") {
    return;
  }
  const company = await loadCompany(database, sample.companyId);
  // A transient R2 error throws here and the message is retried.
  const logo = await loadLogo(dependencies.bucket, company.logoKey);
  let bytes: Uint8Array;
  try {
    bytes = await (dependencies.renderPdf ?? renderDocumentPdf)(
      buildSampleInput(company, dependencies.now?.() ?? new Date()),
      { issuerLogo: logo },
    );
  } catch (error) {
    await database
      .update(sampleRenders)
      .set({ status: "failed" })
      .where(eq(sampleRenders.id, sampleId));
    logSafe("warn", "onboarding.sample_failed", {
      error_type: error instanceof Error ? error.name : "UnknownError",
    });
    return;
  }
  const key = sampleObjectKey(sample.companyId, sampleId);
  await dependencies.bucket.put(key, bytes, {
    httpMetadata: { contentType: "application/pdf" },
  });
  await database
    .update(sampleRenders)
    .set({ status: "ready", fileKey: key })
    .where(eq(sampleRenders.id, sampleId));
}

/** Deletes samples older than 7 days, object first so a failure retries. */
export async function purgeExpiredSamples(input: {
  database: Database;
  bucket: PrivateBucket;
  now: Date;
}): Promise<number> {
  const cutoff = new Date(input.now.getTime() - SAMPLE_RETENTION_MS);
  const expired = await input.database
    .select({ id: sampleRenders.id, fileKey: sampleRenders.fileKey })
    .from(sampleRenders)
    .where(lt(sampleRenders.createdAt, cutoff))
    .limit(500);
  for (const sample of expired) {
    if (sample.fileKey) {
      await input.bucket.delete(sample.fileKey);
    }
    await input.database
      .delete(sampleRenders)
      .where(eq(sampleRenders.id, sample.id));
  }
  return expired.length;
}

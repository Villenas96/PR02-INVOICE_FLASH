import { and, count, eq, gte, inArray, lt } from "drizzle-orm";
import { z } from "zod";

import { createDatabase, type Database } from "@/db";
import { companies } from "@/db/schema/company";
import { documents } from "@/db/schema/document";
import { apiErrorResponse, toApiError } from "@/lib/api/errors";
import { parseJson } from "@/lib/api/validate";
import { getCompanyReadiness } from "@/lib/documents";
import { logSafe } from "@/lib/log";
import {
  getMadridMonthBounds,
  getPlanCapabilities,
  usageWarning,
} from "@/lib/plan";
import {
  type CompanyContext,
  ResourceNotFoundError,
  resolveCompanyContext,
} from "@/services/context";

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;
const SPANISH_TAX_ID_PATTERN =
  /^(?:[0-9]{8}[A-Z]|[XYZ][0-9]{7}[A-Z]|[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J])$/;

const nullableTrimmedText = (maximumLength: number) =>
  z.union([z.string().trim().max(maximumLength), z.null()]);

const taxIdSchema = z
  .union([
    z.null(),
    z.literal(""),
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        SPANISH_TAX_ID_PATTERN,
        "Introduce un NIF, NIE o CIF español válido.",
      ),
  ])
  .transform((value) => (value === "" ? null : value));

const defaultTaxRateSchema = z.preprocess(
  (value) => (typeof value === "number" ? String(value) : value),
  z
    .string()
    .trim()
    .regex(
      /^(?:0(?:\.0{1,2})?|4(?:\.0{1,2})?|10(?:\.0{1,2})?|21(?:\.0{1,2})?)$/,
      "El tipo de IVA debe ser 0, 4, 10 o 21.",
    )
    .transform((value) => `${Number(value).toFixed(2)}`),
);

const retentionRateSchema = z.preprocess(
  (value) => (typeof value === "number" ? String(value) : value),
  z
    .string()
    .trim()
    .regex(
      /^(?:[0-9]|[0-9]{2})(?:\.[0-9]{1,2})?$/,
      "La retención debe estar entre 0 y 99,99.",
    )
    .transform((value) => {
      const [integerPart, fractionalPart = ""] = value.split(".");
      return `${Number(integerPart)}.${fractionalPart.padEnd(2, "0")}`;
    }),
);

const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "La moneda debe usar un código ISO de tres letras.");

const updateCompanySchema = z
  .object({
    legal_name: nullableTrimmedText(200).optional(),
    tax_id: taxIdSchema.optional(),
    address: nullableTrimmedText(500).optional(),
    email: z.string().trim().email("Introduce un correo válido.").optional(),
    phone: nullableTrimmedText(50).optional(),
    default_due_days: z
      .number()
      .int("El plazo de vencimiento debe ser un número entero.")
      .min(1, "El plazo de vencimiento debe ser mayor que cero.")
      .max(3_650, "El plazo de vencimiento no puede superar diez años.")
      .optional(),
    default_tax_rate: defaultTaxRateSchema.optional(),
    retention_rate: retentionRateSchema.optional(),
    currency: currencySchema.optional(),
  })
  .strict()
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    {
      message: "Indica al menos un dato para actualizar.",
    },
  );

type CompanyRow = typeof companies.$inferSelect;
type CompanyUpdate = {
  legalName?: string | null;
  taxId?: string | null;
  address?: string | null;
  email?: string;
  phone?: string | null;
  defaultDueDays?: number;
  defaultTaxRate?: string;
  retentionRate?: string;
  currency?: string;
  updatedAt: Date;
};

function requestIdFrom(request: Request): {
  requestId: string;
  propagatedRequestId?: string;
} {
  const supplied = request.headers.get("x-request-id");
  if (supplied && REQUEST_ID_PATTERN.test(supplied)) {
    return { requestId: supplied, propagatedRequestId: supplied };
  }
  return { requestId: crypto.randomUUID() };
}

function withRequestId(response: Response, requestId: string): Response {
  response.headers.set("x-request-id", requestId);
  return response;
}

function missingFieldName(field: "address" | "legalName" | "taxId"): string {
  if (field === "legalName") {
    return "legal_name";
  }
  if (field === "taxId") {
    return "tax_id";
  }
  return field;
}

function companyResponse(company: CompanyRow, issuedDocumentCount: number) {
  const readiness = getCompanyReadiness(company);
  const capabilities = getPlanCapabilities(company.plan);

  return {
    id: company.id,
    legal_name: company.legalName,
    tax_id: company.taxId,
    address: company.address,
    email: company.email,
    phone: company.phone,
    logo_key: company.logoKey,
    default_due_days: company.defaultDueDays,
    default_tax_rate: company.defaultTaxRate,
    retention_rate: company.retentionRate,
    currency: company.currency,
    plan: company.plan,
    is_ready_to_issue: readiness.ready,
    missing_fields: readiness.missingFields.map(missingFieldName),
    docs_issued_this_month: issuedDocumentCount,
    doc_limit: capabilities.docLimit,
    can_generate_pdf: capabilities.canGeneratePdf,
    can_send_email: capabilities.canSendEmail,
    can_share_link: capabilities.canShareLink,
    usage_warning: usageWarning(company.plan, issuedDocumentCount),
  };
}

function issuedDocumentCountPromise(
  database: Database,
  companyId: string,
  now = new Date(),
): Promise<number> {
  const { start, endExclusive } = getMadridMonthBounds(now);

  return database
    .select({ value: count(documents.id) })
    .from(documents)
    .where(
      and(
        eq(documents.companyId, companyId),
        inArray(documents.status, ["issued", "voided"]),
        gte(documents.issuedAt, start),
        lt(documents.issuedAt, endExclusive),
      ),
    )
    .then(([result]) => Number(result?.value ?? 0));
}

async function loadCompany(
  database: Database,
  context: CompanyContext,
): Promise<CompanyRow> {
  const [company] = await database
    .select()
    .from(companies)
    .where(
      and(
        eq(companies.id, context.companyId),
        eq(companies.userId, context.userId),
      ),
    )
    .limit(1);

  if (!company) {
    throw new ResourceNotFoundError();
  }
  return company;
}

function updatesFrom(
  input: z.output<typeof updateCompanySchema>,
): CompanyUpdate {
  const updates: CompanyUpdate = { updatedAt: new Date() };

  if (input.legal_name !== undefined) {
    updates.legalName = input.legal_name;
  }
  if (input.tax_id !== undefined) {
    updates.taxId = input.tax_id;
  }
  if (input.address !== undefined) {
    updates.address = input.address;
  }
  if (input.email !== undefined) {
    updates.email = input.email;
  }
  if (input.phone !== undefined) {
    updates.phone = input.phone;
  }
  if (input.default_due_days !== undefined) {
    updates.defaultDueDays = input.default_due_days;
  }
  if (input.default_tax_rate !== undefined) {
    updates.defaultTaxRate = input.default_tax_rate;
  }
  if (input.retention_rate !== undefined) {
    updates.retentionRate = input.retention_rate;
  }
  if (input.currency !== undefined) {
    updates.currency = input.currency;
  }

  return updates;
}

function routeErrorResponse(
  error: unknown,
  requestId: string,
  propagatedRequestId?: string,
): Response {
  const apiError = toApiError(error);
  if (apiError.status >= 500) {
    logSafe("error", "company.route_failed", {
      request_id: requestId,
      error_type: error instanceof Error ? error.name : "UnknownError",
    });
  }

  return withRequestId(
    apiErrorResponse(apiError, propagatedRequestId),
    requestId,
  );
}

export async function GET(request: Request): Promise<Response> {
  const { requestId, propagatedRequestId } = requestIdFrom(request);

  try {
    const context = await resolveCompanyContext(request);
    const database = createDatabase();
    const companyPromise = loadCompany(database, context);
    const usagePromise = issuedDocumentCountPromise(
      database,
      context.companyId,
    );
    const [company, issuedDocumentCount] = await Promise.all([
      companyPromise,
      usagePromise,
    ]);

    return withRequestId(
      Response.json(companyResponse(company, issuedDocumentCount)),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}

export async function PUT(request: Request): Promise<Response> {
  const { requestId, propagatedRequestId } = requestIdFrom(request);

  try {
    const contextPromise = resolveCompanyContext(request);
    const inputPromise = parseJson(request, updateCompanySchema);
    const [context, input] = await Promise.all([contextPromise, inputPromise]);
    const database = createDatabase();
    const updatePromise = database
      .update(companies)
      .set(updatesFrom(input))
      .where(
        and(
          eq(companies.id, context.companyId),
          eq(companies.userId, context.userId),
        ),
      )
      .returning();
    const usagePromise = issuedDocumentCountPromise(
      database,
      context.companyId,
    );
    const [[updatedCompany], issuedDocumentCount] = await Promise.all([
      updatePromise,
      usagePromise,
    ]);

    if (!updatedCompany) {
      throw new ResourceNotFoundError();
    }

    return withRequestId(
      Response.json(companyResponse(updatedCompany, issuedDocumentCount)),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}

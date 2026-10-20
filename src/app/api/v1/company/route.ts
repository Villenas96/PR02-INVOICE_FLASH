import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { createDatabase, type Database } from "@/db";
import { companies } from "@/db/schema/company";
import { apiErrorResponse, toApiError } from "@/lib/api/errors";
import { parseJson } from "@/lib/api/validate";
import { logSafe } from "@/lib/log";
import { planLabel } from "@/lib/plan";
import { reminderPolicySchema } from "@/lib/reminders";
import {
  type CompanySummary,
  loadCompanySummary,
  usageResponse,
} from "@/services/company-summary";
import {
  type CompanyContext,
  ResourceNotFoundError,
  resolveCompanyContext,
} from "@/services/context";
import { requireFeature } from "@/services/entitlements";
import { setDefaultIvaRate } from "@/services/tax-rates";

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
    // `null` returns to the plan default; `full` needs Pro (checked below).
    ui_mode: z.enum(["simple", "full"]).nullable().optional(),
    // Pro: automatic payment reminders (FR-041).
    reminder_policy: reminderPolicySchema.optional(),
    // Destination of advisor sends (FR-032, FR-034); `null` removes it.
    advisor_email: z
      .union([
        z.null(),
        z.literal(""),
        z
          .string()
          .trim()
          .max(320)
          .email("Introduce un correo válido para tu asesoría."),
      ])
      .transform((value) =>
        value === "" ? null : (value?.toLowerCase() ?? null),
      )
      .optional(),
  })
  .strict()
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    {
      message: "Indica al menos un dato para actualizar.",
    },
  );

type CompanyUpdate = {
  legalName?: string | null;
  taxId?: string | null;
  address?: string | null;
  email?: string;
  phone?: string | null;
  defaultDueDays?: number;
  retentionRate?: string;
  currency?: string;
  uiMode?: "simple" | "full" | null;
  advisorEmail?: string | null;
  reminderPolicy?: z.output<typeof reminderPolicySchema>;
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

function companyResponse(summary: CompanySummary, context: CompanyContext) {
  const { company } = summary;

  return {
    id: company.id,
    legal_name: company.legalName,
    tax_id: company.taxId,
    address: company.address,
    email: company.email,
    phone: company.phone,
    logo_key: company.logoKey,
    default_due_days: company.defaultDueDays,
    default_tax_rate: summary.defaultTaxRate,
    retention_rate: company.retentionRate,
    currency: company.currency,
    advisor_email: company.advisorEmail,
    reminder_policy: company.reminderPolicy,
    role: context.role,
    plan: summary.plan,
    plan_label: planLabel(summary.plan),
    usage: summary.usage.map(usageResponse),
    features: summary.features,
    ui_mode: summary.uiMode,
    effective_ui: summary.effectiveUi,
    used_document_types: summary.usedDocumentTypes,
    is_ready_to_issue: summary.missingFields.length === 0,
    missing_fields: summary.missingFields,
    missing_to_issue: summary.missingToIssue,
  };
}

async function loadSummary(
  database: Database,
  context: CompanyContext,
): Promise<CompanySummary> {
  const summary = await loadCompanySummary(database, context.companyId);
  if (!summary) {
    throw new ResourceNotFoundError();
  }
  return summary;
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
  if (input.retention_rate !== undefined) {
    updates.retentionRate = input.retention_rate;
  }
  if (input.currency !== undefined) {
    updates.currency = input.currency;
  }
  if (input.ui_mode !== undefined) {
    updates.uiMode = input.ui_mode;
  }
  if (input.advisor_email !== undefined) {
    updates.advisorEmail = input.advisor_email;
  }
  if (input.reminder_policy !== undefined) {
    updates.reminderPolicy = input.reminder_policy;
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
    const context = await resolveCompanyContext(request, { access: "read" });
    const summary = await loadSummary(createDatabase(), context);

    return withRequestId(
      Response.json(companyResponse(summary, context)),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}

export async function PUT(request: Request): Promise<Response> {
  const { requestId, propagatedRequestId } = requestIdFrom(request);

  try {
    const contextPromise = resolveCompanyContext(request, { access: "write" });
    const inputPromise = parseJson(request, updateCompanySchema);
    const [context, input] = await Promise.all([contextPromise, inputPromise]);
    if (input.ui_mode === "full") {
      requireFeature(context, "full_ui");
    }
    if (input.reminder_policy?.enabled) {
      requireFeature(context, "reminders");
    }
    const database = createDatabase();
    const [updatedCompany] = await database
      .update(companies)
      .set(updatesFrom(input))
      .where(
        and(
          eq(companies.id, context.companyId),
          eq(companies.userId, context.userId),
        ),
      )
      .returning({ id: companies.id });

    if (!updatedCompany) {
      throw new ResourceNotFoundError();
    }
    if (input.default_tax_rate !== undefined) {
      await setDefaultIvaRate(
        database,
        context.companyId,
        input.default_tax_rate,
      );
    }

    const summary = await loadSummary(database, context);
    return withRequestId(
      Response.json(companyResponse(summary, context)),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}

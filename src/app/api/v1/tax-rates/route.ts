import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";

import { createDatabase } from "@/db";
import { taxRates } from "@/db/schema/tax-rate";
import { runRoute } from "@/lib/api/route";
import { parseJson, validate } from "@/lib/api/validate";
import { resolveCompanyContext } from "@/services/context";
import {
  createTaxRate,
  ensureTaxRates,
  taxRateResponse,
} from "@/services/tax-rates";

const listQuerySchema = z
  .object({ archived: z.enum(["true", "false"]).optional() })
  .strict();

const taxRateInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Pon nombre al impuesto (IVA, IGIC, IGI…).")
      .max(30, "El nombre no puede superar 30 caracteres."),
    rate: z.union([z.string(), z.number()]),
    is_default: z.boolean().optional(),
  })
  .strict();

export async function GET(request: Request): Promise<Response> {
  return runRoute(request, "tax_rates.list_failed", async () => {
    const query = validate(
      listQuerySchema,
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    const context = await resolveCompanyContext(request, { access: "read" });
    const database = createDatabase();
    await ensureTaxRates(database, context.companyId);
    const rows = await database
      .select()
      .from(taxRates)
      .where(
        and(
          eq(taxRates.companyId, context.companyId),
          query.archived === "true"
            ? isNotNull(taxRates.archivedAt)
            : isNull(taxRates.archivedAt),
        ),
      )
      .orderBy(asc(taxRates.name), asc(taxRates.rate));
    return Response.json({
      items: rows.map(taxRateResponse),
      next_cursor: null,
    });
  });
}

export async function POST(request: Request): Promise<Response> {
  return runRoute(request, "tax_rates.create_failed", async () => {
    const [context, input] = await Promise.all([
      resolveCompanyContext(request, { access: "write" }),
      parseJson(request, taxRateInputSchema),
    ]);
    const row = await createTaxRate(createDatabase(), context.companyId, input);
    return Response.json(taxRateResponse(row), { status: 201 });
  });
}

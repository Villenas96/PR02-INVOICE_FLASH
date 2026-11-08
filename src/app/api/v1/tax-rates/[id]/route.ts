import { z } from "zod";

import { createDatabase } from "@/db";
import { runRoute } from "@/lib/api/route";
import { parseJson, validate } from "@/lib/api/validate";
import { resolveCompanyContext } from "@/services/context";
import { taxRateResponse, updateTaxRate } from "@/services/tax-rates";

const paramsSchema = z.object({ id: z.string().uuid() }).strict();
const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(30).optional(),
    rate: z.union([z.string(), z.number()]).optional(),
    is_default: z.literal(true).optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    {
      message: "Indica al menos un dato para actualizar.",
    },
  );

export async function PATCH(
  request: Request,
  routeContext: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runRoute(request, "tax_rates.update_failed", async () => {
    const [context, params, input] = await Promise.all([
      resolveCompanyContext(request, { access: "write" }),
      routeContext.params.then((value) => validate(paramsSchema, value)),
      parseJson(request, patchSchema),
    ]);
    const row = await updateTaxRate(
      createDatabase(),
      context.companyId,
      params.id,
      input,
    );
    return Response.json(taxRateResponse(row));
  });
}

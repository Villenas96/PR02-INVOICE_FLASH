import { z } from "zod";

import { createDatabase } from "@/db";
import { parseIdempotencyKey } from "@/lib/api/idempotency";
import { runRoute } from "@/lib/api/route";
import { parseJson } from "@/lib/api/validate";
import {
  getAppBaseUrl,
  getStripeTaxRateId,
  isProCheckoutEnabled,
} from "@/lib/env";
import { createCheckoutSession } from "@/services/billing/checkout";
import { getStripeClient } from "@/services/billing/stripe";
import { requireOwner, resolveCompanyContext } from "@/services/context";

const checkoutSchema = z
  .object({
    lookup_key: z.string().trim().min(1).max(64),
    resume_document_id: z.string().uuid().optional(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  return runRoute(request, "billing.checkout_failed", async () => {
    const idempotencyKey = parseIdempotencyKey(request, true) as string;
    const [context, input] = await Promise.all([
      resolveCompanyContext(request, { access: "write" }),
      parseJson(request, checkoutSchema),
    ]);
    requireOwner(context);
    const session = await createCheckoutSession(
      {
        companyId: context.companyId,
        lookupKey: input.lookup_key,
        resumeDocumentId: input.resume_document_id,
        idempotencyKey,
        proCheckoutEnabled: isProCheckoutEnabled(),
        taxRateId: getStripeTaxRateId(),
      },
      {
        database: createDatabase(),
        stripe: getStripeClient(),
        appBaseUrl: getAppBaseUrl(),
      },
    );
    return Response.json(session);
  });
}

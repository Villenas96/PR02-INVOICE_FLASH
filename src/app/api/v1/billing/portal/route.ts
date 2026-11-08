import { createDatabase } from "@/db";
import { runRoute } from "@/lib/api/route";
import { getAppBaseUrl } from "@/lib/env";
import { createPortalSession } from "@/services/billing/checkout";
import { getStripeClient } from "@/services/billing/stripe";
import { requireOwner, resolveCompanyContext } from "@/services/context";

export async function POST(request: Request): Promise<Response> {
  return runRoute(request, "billing.portal_failed", async () => {
    const context = await resolveCompanyContext(request, { access: "write" });
    requireOwner(context);
    const session = await createPortalSession(context.companyId, {
      database: createDatabase(),
      stripe: getStripeClient(),
      appBaseUrl: getAppBaseUrl(),
    });
    return Response.json(session);
  });
}

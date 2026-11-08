import { z } from "zod";

import { runRoute } from "@/lib/api/route";
import { validate } from "@/lib/api/validate";
import { resolveCompanyContext } from "@/services/context";
import { topClients } from "@/services/dashboard";
import { requireFeature } from "@/services/entitlements";

const querySchema = z
  .object({ from: z.iso.date().optional(), to: z.iso.date().optional() })
  .strict();

/** Top 5 clients by invoiced total in the period (Pro, FR-046). */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, "dashboard.top_clients_failed", async () => {
    const query = validate(
      querySchema,
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const context = await resolveCompanyContext(request, { access: "read" });
    requireFeature(context, "dashboard_full");
    const clients = await topClients(context.companyId, query);
    return Response.json({
      items: clients.map((client) => ({
        client_id: client.clientId,
        name: client.name,
        invoiced_cents: client.invoicedCents,
        invoice_count: client.invoiceCount,
      })),
    });
  });
}

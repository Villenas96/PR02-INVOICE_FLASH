import { runRoute } from "@/lib/api/route";
import { madridDate } from "@/lib/plan";
import { resolveCompanyContext } from "@/services/context";
import { monthlySeries } from "@/services/dashboard";
import { requireFeature } from "@/services/entitlements";

/** Invoiced vs collected over the last 12 months (Pro, FR-046). */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, "dashboard.monthly_failed", async () => {
    const context = await resolveCompanyContext(request, { access: "read" });
    requireFeature(context, "dashboard_full");
    const series = await monthlySeries(
      context.companyId,
      madridDate(new Date()),
    );
    return Response.json({
      items: series.map((point) => ({
        month: point.month,
        invoiced_cents: point.invoicedCents,
        collected_cents: point.collectedCents,
      })),
    });
  });
}

import { runRoute } from "@/lib/api/route";
import { madridDate } from "@/lib/plan";
import { resolveCompanyContext } from "@/services/context";
import { treasury } from "@/services/dashboard";
import { requireFeature } from "@/services/entitlements";

/** Bank balance and expected collections at 30 days (Pro, FR-047). */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, "dashboard.treasury_failed", async () => {
    const context = await resolveCompanyContext(request, { access: "read" });
    requireFeature(context, "dashboard_full");
    const figures = await treasury(context.companyId, madridDate(new Date()));
    return Response.json({
      balance_cents: figures.balanceCents,
      balance_on: figures.balanceOn,
      expected_30_days_cents: figures.expected30DaysCents,
      overdue_cents: figures.overdueCents,
    });
  });
}

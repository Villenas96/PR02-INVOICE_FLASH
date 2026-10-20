import { eq } from "drizzle-orm";

import { createDatabase } from "@/db";
import { subscriptions } from "@/db/schema/subscription";
import { runRoute } from "@/lib/api/route";
import { requireOwner, resolveCompanyContext } from "@/services/context";

export async function GET(request: Request): Promise<Response> {
  return runRoute(request, "billing.subscription_failed", async () => {
    const context = await resolveCompanyContext(request, { access: "read" });
    requireOwner(context);
    const [row] = await createDatabase()
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.companyId, context.companyId))
      .limit(1);

    return Response.json({
      plan: row ? row.plan : "basic",
      effective_plan: context.plan,
      interval: row?.interval ?? null,
      status: row && row.status !== "incomplete" ? row.status : null,
      current_period_end: row?.currentPeriodEnd ?? null,
      cancel_at_period_end: row?.cancelAtPeriodEnd ?? false,
      grace_until: row?.graceUntil ?? null,
    });
  });
}

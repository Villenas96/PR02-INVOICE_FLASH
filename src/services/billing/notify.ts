import type { Database } from "@/db";
import { getQueue } from "@/lib/cloudflare";
import { isUpgrade, type ReconcileResult } from "@/services/billing/reconcile";
import { enqueueNotice } from "@/services/email/notices";

/** Plan activated / downgraded notice, once per effective plan change. */
export async function notifyPlanChange(
  database: Database,
  result: ReconcileResult | null,
): Promise<void> {
  if (!result?.changed || !result.planChangeId) {
    return;
  }
  const upgraded = isUpgrade(result.previousPlan, result.effectivePlan);
  await enqueueNotice({
    database,
    queue: await getQueue("EMAIL_SEND_QUEUE"),
    purpose: "billing_notice",
    template: upgraded ? "billing_plan_activated" : "billing_downgraded",
    companyId: result.companyId,
    idempotencyKey: `billing_notice:plan_change:${result.planChangeId}`,
    payload: { plan: result.effectivePlan },
  });
}

export async function notifyPaymentFailed(
  database: Database,
  result: ReconcileResult | null,
): Promise<void> {
  const graceUntil = result?.subscription.graceUntil;
  if (!result || result.subscription.status !== "past_due" || !graceUntil) {
    return;
  }
  // One notice per grace period, however many retries fail within it.
  await enqueueNotice({
    database,
    queue: await getQueue("EMAIL_SEND_QUEUE"),
    purpose: "billing_notice",
    template: "billing_payment_failed",
    companyId: result.companyId,
    idempotencyKey: `billing_notice:payment_failed:${result.companyId}:${graceUntil.toISOString()}`,
    payload: {
      plan: result.subscription.plan,
      grace_until: graceUntil.toISOString(),
    },
  });
}

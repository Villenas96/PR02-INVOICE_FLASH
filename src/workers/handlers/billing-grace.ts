import { and, eq, isNull } from "drizzle-orm";

import { createDatabase, type Database } from "@/db";
import { subscriptions } from "@/db/schema/subscription";
import { graceNoticeDue, isGraceExpired } from "@/lib/billing-plan";
import { logSafe } from "@/lib/log";
import { reconcileSubscription } from "@/services/billing/reconcile";
import { getStripeClient, type StripeClient } from "@/services/billing/stripe";
import type { EmailQueue } from "@/services/email/auth-deliveries";
import { enqueueNotice } from "@/services/email/notices";

export interface BillingGraceDependencies {
  database?: Database;
  stripe?: StripeClient;
  emailQueue: EmailQueue;
  now?: Date;
}

/**
 * Grace step for one company (FR-011, research R1): day-5 notice once, and on
 * expiry the downgrade to Basic (by reconciliation, so `plan_change` records
 * `grace_expired`) followed by cancelling the Stripe subscription so Stripe
 * stops retrying a charge for a plan the customer no longer has. Idempotent:
 * redeliveries find the notice claimed or the plan already downgraded.
 */
export async function handleBillingGrace(
  message: { companyId: string },
  dependencies: BillingGraceDependencies,
): Promise<void> {
  const database = dependencies.database ?? createDatabase();
  const stripe = dependencies.stripe ?? getStripeClient();
  const now = dependencies.now ?? new Date();
  const [subscription] = await database
    .select({
      status: subscriptions.status,
      plan: subscriptions.plan,
      graceUntil: subscriptions.graceUntil,
      graceNoticeSentAt: subscriptions.graceNoticeSentAt,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
    })
    .from(subscriptions)
    .where(eq(subscriptions.companyId, message.companyId))
    .limit(1);

  if (subscription?.status !== "past_due" || !subscription.graceUntil) {
    return;
  }
  const graceUntil = subscription.graceUntil;

  if (isGraceExpired(graceUntil, now)) {
    const result = await reconcileSubscription(
      { companyId: message.companyId },
      { database, stripe, now, reason: "grace_expired" },
    );
    if (result?.changed && result.planChangeId) {
      await enqueueNotice({
        database,
        queue: dependencies.emailQueue,
        purpose: "billing_notice",
        template: "billing_downgraded",
        companyId: message.companyId,
        idempotencyKey: `billing_notice:plan_change:${result.planChangeId}`,
        payload: { plan: result.effectivePlan },
        now,
      });
    }
    if (subscription.stripeSubscriptionId) {
      try {
        await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
      } catch (error) {
        // Already canceled in Stripe (e.g. by its own retry rules) is fine;
        // the local downgrade above is what the customer sees.
        logSafe("warn", "billing.grace_cancel_failed", {
          error_type: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }
    return;
  }

  if (!graceNoticeDue(graceUntil, now) || subscription.graceNoticeSentAt) {
    return;
  }
  const [claimed] = await database
    .update(subscriptions)
    .set({ graceNoticeSentAt: now, updatedAt: now })
    .where(
      and(
        eq(subscriptions.companyId, message.companyId),
        isNull(subscriptions.graceNoticeSentAt),
      ),
    )
    .returning({ companyId: subscriptions.companyId });
  if (!claimed) {
    return;
  }
  await enqueueNotice({
    database,
    queue: dependencies.emailQueue,
    purpose: "billing_notice",
    template: "billing_grace_ending",
    companyId: message.companyId,
    idempotencyKey: `billing_notice:grace_ending:${message.companyId}:${graceUntil.toISOString()}`,
    payload: {
      plan: subscription.plan,
      grace_until: graceUntil.toISOString(),
    },
    now,
  });
}

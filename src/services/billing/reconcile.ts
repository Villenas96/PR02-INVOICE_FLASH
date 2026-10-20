import { eq, sql } from "drizzle-orm";
import type Stripe from "stripe";

import { createDatabase, type Database } from "@/db";
import { firstExecutionRow } from "@/db/result";
import { companies } from "@/db/schema/company";
import { planChanges } from "@/db/schema/plan-change";
import { subscriptions } from "@/db/schema/subscription";
import {
  type BillingInterval,
  effectivePlan,
  graceUntilAfterFailure,
  mapStripeStatus,
  parseLookupKey,
  type StripeSubscriptionStatus,
  type SubscriptionStatus,
} from "@/lib/billing-plan";
import { createUuidV7 } from "@/lib/ids";
import { logSafe } from "@/lib/log";
import { normalizePlan, type Plan, type StoredPlan } from "@/lib/plan";
import { getStripeClient, type StripeClient } from "@/services/billing/stripe";

export type PlanChangeReason = (typeof planChanges.$inferInsert)["reason"];

export interface ReconcileTarget {
  companyId?: string;
  stripeCustomerId?: string;
}

export interface ReconcileOptions {
  database?: Database;
  stripe?: StripeClient;
  now?: Date;
  /** Origin recorded in `plan_change` when the change is not a downgrade
   * explained by the Stripe state itself (cancellation, grace expiry). */
  reason?: PlanChangeReason;
  billingEventId?: string | null;
  /** A renewal payment just failed: open the grace period if needed. */
  paymentFailed?: boolean;
}

export interface ReconciledSubscription {
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  plan: Plan;
  interval: BillingInterval | null;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  graceUntil: Date | null;
}

export interface ReconcileResult {
  companyId: string;
  previousPlan: StoredPlan;
  effectivePlan: Plan;
  changed: boolean;
  planChangeId: string | null;
  subscription: ReconciledSubscription;
}

/** Statuses that represent the customer's live subscription. */
const LIVE_STATUSES = new Set<string>([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
]);

function currentStripeSubscription(
  list: Stripe.Subscription[],
): Stripe.Subscription | null {
  const sorted = [...list].sort((left, right) => right.created - left.created);
  return (
    sorted.find((subscription) => LIVE_STATUSES.has(subscription.status)) ??
    sorted[0] ??
    null
  );
}

function fromStripe(
  customer: string,
  subscription: Stripe.Subscription | null,
): Omit<ReconciledSubscription, "graceUntil"> {
  if (!subscription) {
    return {
      stripeCustomerId: customer,
      stripeSubscriptionId: null,
      plan: "basic",
      interval: null,
      status: "incomplete",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    };
  }

  const item = subscription.items.data[0];
  const lookup = parseLookupKey(item?.price.lookup_key ?? "");
  if (!lookup) {
    // Unknown price: never grant a paid plan we cannot identify.
    logSafe("warn", "billing.unknown_price", {
      has_item: Boolean(item),
    });
  }
  return {
    stripeCustomerId: customer,
    stripeSubscriptionId: subscription.id,
    plan: lookup?.plan ?? "basic",
    interval: lookup?.interval ?? null,
    status: mapStripeStatus(subscription.status as StripeSubscriptionStatus),
    currentPeriodEnd: item?.current_period_end
      ? new Date(item.current_period_end * 1_000)
      : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  };
}

function changeReason(
  effective: Plan,
  status: SubscriptionStatus,
  requested: PlanChangeReason | undefined,
): PlanChangeReason {
  if (effective === "basic" && status === "canceled") {
    return "canceled";
  }
  if (effective === "basic" && status === "past_due") {
    return "grace_expired";
  }
  return requested ?? "portal";
}

interface ApplyRow extends Record<string, unknown> {
  previous_plan: StoredPlan | null;
  plan_change_id: string | null;
}

/**
 * Re-reads the customer's subscription from the Stripe API (never trusting a
 * webhook payload, so duplicated or out-of-order events converge) and writes
 * the subscription copy, the effective `company.plan` and — only when the
 * effective plan changes — one `plan_change`, all in a single statement
 * under the company lock (FR-010, FR-013, research R1).
 */
export async function reconcileSubscription(
  target: ReconcileTarget,
  options: ReconcileOptions = {},
): Promise<ReconcileResult | null> {
  const database = options.database ?? createDatabase();
  const stripe = options.stripe ?? getStripeClient();
  const now = options.now ?? new Date();

  const [existing] = await database
    .select({
      companyId: subscriptions.companyId,
      stripeCustomerId: subscriptions.stripeCustomerId,
      graceUntil: subscriptions.graceUntil,
    })
    .from(subscriptions)
    .where(
      target.companyId
        ? eq(subscriptions.companyId, target.companyId)
        : eq(subscriptions.stripeCustomerId, target.stripeCustomerId ?? ""),
    )
    .limit(1);

  const companyId = target.companyId ?? existing?.companyId;
  const customer = target.stripeCustomerId ?? existing?.stripeCustomerId;
  if (!companyId || !customer) {
    return null;
  }

  const listed = await stripe.subscriptions.list({
    customer,
    status: "all",
    limit: 10,
  });
  const state = fromStripe(customer, currentStripeSubscription(listed.data));
  const graceUntil =
    state.status === "past_due"
      ? (existing?.graceUntil ?? graceUntilAfterFailure(now))
      : null;
  if (options.paymentFailed && state.status !== "past_due") {
    logSafe("info", "billing.payment_failed_not_past_due", {
      status: state.status,
    });
  }
  const subscription: ReconciledSubscription = { ...state, graceUntil };
  const effective = effectivePlan(
    { plan: state.plan, status: state.status, graceUntil },
    now,
  );
  const reason = changeReason(effective, state.status, options.reason);
  const nowIso = now.toISOString();
  const planChangeId = createUuidV7(now.getTime());

  const result = await database.execute<ApplyRow>(sql`
    WITH locked_company AS MATERIALIZED (
      SELECT ${companies.id} AS id, ${companies.plan} AS plan
      FROM ${companies}
      WHERE ${companies.id} = ${companyId}
      FOR UPDATE
    ),
    upserted AS (
      INSERT INTO ${subscriptions} (
        id, company_id, stripe_customer_id, stripe_subscription_id, plan,
        interval, status, current_period_end, cancel_at_period_end,
        grace_until, last_synced_at, created_at, updated_at
      )
      SELECT
        ${createUuidV7(now.getTime())}, locked_company.id, ${customer},
        ${subscription.stripeSubscriptionId}, ${subscription.plan}::plan,
        ${subscription.interval}::billing_interval,
        ${subscription.status}::subscription_status,
        ${subscription.currentPeriodEnd?.toISOString() ?? null}::timestamptz,
        ${subscription.cancelAtPeriodEnd}::boolean,
        ${graceUntil?.toISOString() ?? null}::timestamptz,
        ${nowIso}, ${nowIso}, ${nowIso}
      FROM locked_company
      ON CONFLICT (company_id) DO UPDATE SET
        stripe_customer_id = EXCLUDED.stripe_customer_id,
        stripe_subscription_id = EXCLUDED.stripe_subscription_id,
        plan = EXCLUDED.plan,
        interval = EXCLUDED.interval,
        status = EXCLUDED.status,
        current_period_end = EXCLUDED.current_period_end,
        cancel_at_period_end = EXCLUDED.cancel_at_period_end,
        grace_until = EXCLUDED.grace_until,
        grace_notice_sent_at = CASE
          WHEN EXCLUDED.grace_until IS NULL THEN NULL
          ELSE ${subscriptions}.grace_notice_sent_at
        END,
        last_synced_at = EXCLUDED.last_synced_at,
        updated_at = EXCLUDED.updated_at
      RETURNING id
    ),
    changed AS (
      UPDATE ${companies} target
      SET plan = ${effective}::plan, updated_at = ${nowIso}
      FROM locked_company
      WHERE target.id = locked_company.id
        AND locked_company.plan <> ${effective}::plan
        AND NOT (locked_company.plan = 'free'::plan AND ${effective}::plan = 'basic'::plan)
      RETURNING locked_company.plan AS from_plan
    ),
    inserted_change AS (
      INSERT INTO ${planChanges} (
        id, company_id, from_plan, to_plan, reason, billing_event_id, created_at
      )
      SELECT
        ${planChangeId}, ${companyId}, changed.from_plan, ${effective}::plan,
        ${reason}::plan_change_reason, ${options.billingEventId ?? null}::uuid,
        ${nowIso}
      FROM changed
      RETURNING id
    )
    SELECT
      (SELECT plan FROM locked_company) AS previous_plan,
      (SELECT id FROM inserted_change) AS plan_change_id
    FROM (SELECT count(*) FROM upserted) AS upsert_barrier
  `);
  const row = firstExecutionRow<ApplyRow>(result);
  if (!row?.previous_plan) {
    return null;
  }

  return {
    companyId,
    previousPlan: row.previous_plan,
    effectivePlan: effective,
    changed: row.plan_change_id !== null,
    planChangeId: row.plan_change_id,
    subscription,
  };
}

export function isUpgrade(from: StoredPlan, to: Plan): boolean {
  const order: Plan[] = ["basic", "essential", "pro"];
  return order.indexOf(to) > order.indexOf(normalizePlan(from));
}

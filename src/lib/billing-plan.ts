import type { Plan } from "@/lib/plan";

/**
 * Subscription rules (specs/002 research R1, data-model «subscription»):
 * effective plan, the 7-day grace period after a failed renewal, and the
 * mapping from Stripe statuses and price lookup keys.
 */

export type SubscriptionStatus =
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete";
export type BillingInterval = "month" | "year";

export interface BillingSubscription {
  plan: Plan;
  status: SubscriptionStatus;
  graceUntil: Date | null;
}

export const GRACE_PERIOD_DAYS = 7;
/** The grace notice goes out from day 5 of the grace period. */
export const GRACE_NOTICE_DAY = 5;
const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * `active` → contracted plan; `past_due` → contracted plan while
 * `now < grace_until`; anything else (or no subscription) → `basic`.
 */
export function effectivePlan(
  subscription: BillingSubscription | null,
  now: Date,
): Plan {
  if (!subscription) {
    return "basic";
  }
  if (subscription.status === "active") {
    return subscription.plan;
  }
  if (
    subscription.status === "past_due" &&
    subscription.graceUntil &&
    now.getTime() < subscription.graceUntil.getTime()
  ) {
    return subscription.plan;
  }
  return "basic";
}

export function graceUntilAfterFailure(failedAt: Date): Date {
  return new Date(failedAt.getTime() + GRACE_PERIOD_DAYS * DAY_MS);
}

export function isGraceExpired(graceUntil: Date, now: Date): boolean {
  return now.getTime() >= graceUntil.getTime();
}

export function graceNoticeDue(graceUntil: Date, now: Date): boolean {
  const noticeFrom =
    graceUntil.getTime() - (GRACE_PERIOD_DAYS - GRACE_NOTICE_DAY) * DAY_MS;
  return now.getTime() >= noticeFrom && !isGraceExpired(graceUntil, now);
}

export type StripeSubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "unpaid"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "paused";

export function mapStripeStatus(
  status: StripeSubscriptionStatus,
): SubscriptionStatus {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "incomplete":
      return "incomplete";
    case "canceled":
    case "incomplete_expired":
    case "paused":
      return "canceled";
  }
}

export const LOOKUP_KEYS = [
  "essential_monthly",
  "essential_yearly",
  "pro_monthly",
  "pro_yearly",
] as const;
export type LookupKey = (typeof LOOKUP_KEYS)[number];

export function isLookupKey(value: string): value is LookupKey {
  return (LOOKUP_KEYS as readonly string[]).includes(value);
}

export function parseLookupKey(
  value: string,
): { plan: Exclude<Plan, "basic">; interval: BillingInterval } | null {
  if (!isLookupKey(value)) {
    return null;
  }
  const [plan, period] = value.split("_") as [
    Exclude<Plan, "basic">,
    "monthly" | "yearly",
  ];
  return { plan, interval: period === "monthly" ? "month" : "year" };
}

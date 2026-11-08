import { describe, expect, it } from "vitest";

import {
  type BillingSubscription,
  effectivePlan,
  GRACE_PERIOD_DAYS,
  graceNoticeDue,
  graceUntilAfterFailure,
  isGraceExpired,
  mapStripeStatus,
  parseLookupKey,
} from "@/lib/billing-plan";

const now = new Date("2026-10-20T10:00:00.000Z");

function subscription(
  overrides: Partial<BillingSubscription> = {},
): BillingSubscription {
  return {
    plan: "essential",
    status: "active",
    graceUntil: null,
    ...overrides,
  };
}

describe("effectivePlan", () => {
  it("is basic without a subscription", () => {
    expect(effectivePlan(null, now)).toBe("basic");
  });

  it("keeps the contracted plan while active", () => {
    expect(effectivePlan(subscription({ plan: "pro" }), now)).toBe("pro");
  });

  it("keeps the plan during the grace period of a past_due subscription", () => {
    const graceUntil = new Date("2026-10-22T10:00:00.000Z");
    expect(
      effectivePlan(subscription({ status: "past_due", graceUntil }), now),
    ).toBe("essential");
  });

  it("downgrades to basic once the grace period has expired", () => {
    expect(
      effectivePlan(subscription({ status: "past_due", graceUntil: now }), now),
    ).toBe("basic");
    expect(
      effectivePlan(
        subscription({ status: "past_due", graceUntil: null }),
        now,
      ),
    ).toBe("basic");
  });

  it("is basic for canceled and incomplete subscriptions", () => {
    expect(effectivePlan(subscription({ status: "canceled" }), now)).toBe(
      "basic",
    );
    expect(effectivePlan(subscription({ status: "incomplete" }), now)).toBe(
      "basic",
    );
  });
});

describe("grace handling", () => {
  it("lasts seven days from the failed renewal", () => {
    expect(GRACE_PERIOD_DAYS).toBe(7);
    expect(graceUntilAfterFailure(now)).toEqual(
      new Date("2026-10-27T10:00:00.000Z"),
    );
  });

  it("sends the notice from day five until expiry", () => {
    const graceUntil = graceUntilAfterFailure(now);
    expect(
      graceNoticeDue(graceUntil, new Date("2026-10-24T09:59:59.000Z")),
    ).toBe(false);
    expect(
      graceNoticeDue(graceUntil, new Date("2026-10-25T10:00:00.000Z")),
    ).toBe(true);
    expect(graceNoticeDue(graceUntil, graceUntil)).toBe(false);
    expect(isGraceExpired(graceUntil, graceUntil)).toBe(true);
    expect(isGraceExpired(graceUntil, now)).toBe(false);
  });
});

describe("Stripe mapping", () => {
  it.each([
    ["active", "active"],
    ["trialing", "active"],
    ["past_due", "past_due"],
    ["unpaid", "past_due"],
    ["canceled", "canceled"],
    ["incomplete_expired", "canceled"],
    ["paused", "canceled"],
    ["incomplete", "incomplete"],
  ] as const)("maps %s to %s", (stripeStatus, local) => {
    expect(mapStripeStatus(stripeStatus)).toBe(local);
  });

  it("parses price lookup keys into plan and interval", () => {
    expect(parseLookupKey("essential_monthly")).toEqual({
      plan: "essential",
      interval: "month",
    });
    expect(parseLookupKey("pro_yearly")).toEqual({
      plan: "pro",
      interval: "year",
    });
    expect(parseLookupKey("basic_monthly")).toBeNull();
    expect(parseLookupKey("unknown")).toBeNull();
  });
});

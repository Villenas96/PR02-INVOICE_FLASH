import { describe, expect, it } from "vitest";

import {
  parseReminderPolicy,
  reminderDatesFor,
  reminderDueOn,
  reminderHorizonDays,
  reminderPolicySchema,
} from "@/lib/reminders";

const POLICY = {
  enabled: true,
  days_before: 3,
  on_due: true,
  every_days_after: 7,
  max_count: 3,
};

describe("reminderDatesFor", () => {
  it("3 days before, on the due date and every 7 days after, max 3", () => {
    expect(reminderDatesFor(POLICY, "2026-10-20")).toEqual([
      "2026-10-17",
      "2026-10-20",
      "2026-10-27",
    ]);
  });

  it("caps at max_count", () => {
    expect(reminderDatesFor({ ...POLICY, max_count: 2 }, "2026-10-20")).toEqual(
      ["2026-10-17", "2026-10-20"],
    );
    expect(
      reminderDatesFor(
        { enabled: true, every_days_after: 1, max_count: 4 },
        "2026-10-30",
      ),
    ).toEqual(["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"]);
  });

  it("only after the due date", () => {
    expect(
      reminderDatesFor(
        { enabled: true, every_days_after: 15, max_count: 3 },
        "2026-01-20",
      ),
    ).toEqual(["2026-02-04", "2026-02-19", "2026-03-06"]);
  });

  it("only on the due date", () => {
    expect(
      reminderDatesFor(
        { enabled: true, on_due: true, max_count: 5 },
        "2026-10-20",
      ),
    ).toEqual(["2026-10-20"]);
    // «0 days before» is the due date.
    expect(
      reminderDatesFor(
        { enabled: true, days_before: 0, max_count: 5 },
        "2026-10-20",
      ),
    ).toEqual(["2026-10-20"]);
  });

  it("is empty when disabled", () => {
    expect(
      reminderDatesFor({ ...POLICY, enabled: false }, "2026-10-20"),
    ).toEqual([]);
  });
});

describe("reminderDueOn", () => {
  it.each([
    ["2026-10-16", null],
    ["2026-10-17", { sequence: 1, scheduledOn: "2026-10-17" }],
    ["2026-10-18", null],
    ["2026-10-20", { sequence: 2, scheduledOn: "2026-10-20" }],
    ["2026-10-27", { sequence: 3, scheduledOn: "2026-10-27" }],
    ["2026-11-03", null],
  ])("today %s", (today, expected) => {
    expect(reminderDueOn(POLICY, "2026-10-20", today)).toEqual(expected);
  });
});

describe("policy validation", () => {
  it("accepts a complete policy and the disabled one", () => {
    expect(reminderPolicySchema.safeParse(POLICY).success).toBe(true);
    expect(reminderPolicySchema.safeParse({ enabled: false }).success).toBe(
      true,
    );
  });

  it.each([
    { enabled: true },
    { enabled: true, max_count: 3 },
    { ...POLICY, days_before: 31 },
    { ...POLICY, every_days_after: 0 },
    { ...POLICY, max_count: 11 },
    { ...POLICY, extra: true },
  ])("rejects %j", (policy) => {
    expect(reminderPolicySchema.safeParse(policy).success).toBe(false);
  });

  it("treats stored garbage as disabled", () => {
    expect(parseReminderPolicy({ nope: 1 })).toEqual({ enabled: false });
    expect(parseReminderPolicy(null)).toEqual({ enabled: false });
  });

  it("knows how far after the due date it can still send", () => {
    expect(reminderHorizonDays(POLICY)).toBe(7);
    expect(reminderHorizonDays({ enabled: false })).toBe(0);
  });
});

import { describe, expect, it } from "vitest";

import {
  cycleDate,
  isFinished,
  nextRunOn,
  pendingCycles,
  type RecurrenceRule,
} from "@/lib/recurrence";

const rule = (overrides: Partial<RecurrenceRule>): RecurrenceRule => ({
  frequency: "monthly",
  startOn: "2026-01-31",
  ...overrides,
});

describe("cycleDate", () => {
  it("monthly from the 31st lands on the last day of short months without drifting", () => {
    const dates = Array.from({ length: 12 }, (_, i) => cycleDate(rule({}), i));
    expect(dates).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
      "2026-07-31",
      "2026-08-31",
      "2026-09-30",
      "2026-10-31",
      "2026-11-30",
      "2026-12-31",
    ]);
  });

  it("handles leap years", () => {
    expect(cycleDate(rule({ startOn: "2027-12-31" }), 2)).toBe("2028-02-29");
    expect(
      cycleDate(rule({ startOn: "2028-02-29", frequency: "annual" }), 1),
    ).toBe("2029-02-28");
  });

  it.each([
    ["weekly", "2026-03-04", 3, "2026-03-25"],
    ["quarterly", "2026-01-15", 2, "2026-07-15"],
    ["semiannual", "2026-03-10", 3, "2027-09-10"],
    ["annual", "2026-06-30", 2, "2028-06-30"],
  ] as const)(
    "%s from %s, cycle %i → %s",
    (frequency, startOn, index, expected) => {
      expect(cycleDate(rule({ frequency, startOn }), index)).toBe(expected);
    },
  );

  it.each([
    ["day", 10, "2026-01-01", 3, "2026-01-31"],
    ["week", 2, "2026-01-01", 2, "2026-01-29"],
    ["month", 2, "2026-01-31", 1, "2026-03-31"],
    ["month", 5, "2026-10-31", 2, "2027-08-31"],
  ] as const)(
    "every %i %s",
    (intervalUnit, intervalCount, startOn, index, expected) => {
      expect(
        cycleDate(
          rule({ frequency: "custom", intervalUnit, intervalCount, startOn }),
          index,
        ),
      ).toBe(expected);
    },
  );

  it("rejects a custom rule without interval", () => {
    expect(() => cycleDate(rule({ frequency: "custom" }), 1)).toThrow(
      RangeError,
    );
    expect(() =>
      cycleDate(
        rule({ frequency: "custom", intervalCount: 0, intervalUnit: "day" }),
        1,
      ),
    ).toThrow(RangeError);
  });
});

describe("end of the series", () => {
  it("ends after max cycles", () => {
    const limited = rule({ maxCycles: 3 });
    expect(nextRunOn(limited, 2)).toBe("2026-03-31");
    expect(nextRunOn(limited, 3)).toBeNull();
    expect(isFinished(limited, 3)).toBe(true);
    expect(isFinished(limited, 2)).toBe(false);
  });

  it("ends by date, inclusive", () => {
    const dated = rule({ endOn: "2026-04-30" });
    expect(nextRunOn(dated, 3)).toBe("2026-04-30");
    expect(nextRunOn(dated, 4)).toBeNull();
  });
});

describe("pendingCycles", () => {
  it("returns nothing before the first date", () => {
    expect(pendingCycles(rule({}), 0, "2026-01-30")).toEqual([]);
  });

  it("returns the due cycle on its day", () => {
    expect(pendingCycles(rule({}), 0, "2026-01-31")).toEqual([
      { index: 0, scheduledOn: "2026-01-31" },
    ]);
  });

  it("recovers every missed cycle after downtime, oldest first, none twice", () => {
    expect(pendingCycles(rule({}), 1, "2026-04-02")).toEqual([
      { index: 1, scheduledOn: "2026-02-28" },
      { index: 2, scheduledOn: "2026-03-31" },
    ]);
    expect(pendingCycles(rule({}), 3, "2026-04-02")).toEqual([]);
  });

  it("stops at the end of the series", () => {
    expect(pendingCycles(rule({ maxCycles: 2 }), 0, "2030-01-01")).toHaveLength(
      2,
    );
  });

  it("caps the catch-up so a long outage cannot flood", () => {
    expect(
      pendingCycles(rule({ frequency: "weekly" }), 0, "2030-01-01", 5),
    ).toHaveLength(5);
  });
});

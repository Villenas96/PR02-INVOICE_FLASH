import { describe, expect, it } from "vitest";

import { lifecycleRuleProblems } from "../../scripts/r2-lifecycle";

const compliant = [
  { prefix: "exports/", expireAfterDays: 8, enabled: true },
  { prefix: "imports/", expireAfterDays: 8, enabled: true },
];

describe("R2 lifecycle evidence", () => {
  it("accepts 8-day expiry on exports/ and imports/", () => {
    expect(lifecycleRuleProblems(compliant)).toEqual([]);
  });

  it("fails when a prefix is missing or disabled", () => {
    expect(lifecycleRuleProblems([compliant[0] as never])).toEqual([
      "missing enabled lifecycle rule for imports/",
    ]);
    expect(
      lifecycleRuleProblems([
        compliant[0] as never,
        { prefix: "imports/", expireAfterDays: 8, enabled: false },
      ]),
    ).toHaveLength(1);
  });

  it("fails when objects would outlive or die before their token", () => {
    expect(
      lifecycleRuleProblems([
        { prefix: "exports/", expireAfterDays: 7, enabled: true },
        { prefix: "imports/", expireAfterDays: 90, enabled: true },
      ]),
    ).toHaveLength(2);
  });
});

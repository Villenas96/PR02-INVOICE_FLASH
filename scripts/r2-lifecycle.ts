import { z } from "zod";

/**
 * Export and import files must disappear from R2 shortly after their
 * download tokens expire (7 days): rules expire them after 8 days, keeping
 * one day of margin, and never later than 30 days (data minimisation).
 */
export const REQUIRED_LIFECYCLE_PREFIXES = ["exports/", "imports/"] as const;
export const MIN_EXPIRY_DAYS = 8;
export const MAX_EXPIRY_DAYS = 30;

export const lifecycleRuleSchema = z.object({
  prefix: z.string().min(1),
  expireAfterDays: z.number().int().positive(),
  enabled: z.boolean(),
});
export type LifecycleRule = z.infer<typeof lifecycleRuleSchema>;

/** Returns one message per missing or wrong rule; empty when compliant. */
export function lifecycleRuleProblems(rules: LifecycleRule[]): string[] {
  return REQUIRED_LIFECYCLE_PREFIXES.flatMap((prefix) => {
    const rule = rules.find(
      (candidate) => candidate.prefix === prefix && candidate.enabled,
    );
    if (!rule) {
      return [`missing enabled lifecycle rule for ${prefix}`];
    }
    if (
      rule.expireAfterDays < MIN_EXPIRY_DAYS ||
      rule.expireAfterDays > MAX_EXPIRY_DAYS
    ) {
      return [
        `lifecycle rule for ${prefix} must expire objects after ${MIN_EXPIRY_DAYS}–${MAX_EXPIRY_DAYS} days (got ${rule.expireAfterDays})`,
      ];
    }
    return [];
  });
}

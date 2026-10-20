import { z } from "zod";

import { addCalendarDays } from "@/lib/dates";

/**
 * Payment reminder policy and dates (FR-041, FR-042). Pure: `today` and the
 * due date are `YYYY-MM-DD` strings in Europe/Madrid.
 *
 * The policy yields an ordered list of send dates — `days_before` the due
 * date, the due date itself, then every N days after it — capped at
 * `max_count`. A reminder is sent only ON its date (never as catch-up), so
 * a missed planner run cannot flood a client and there is at most one per
 * invoice and day.
 */

export const reminderPolicySchema = z
  .object({
    enabled: z.boolean(),
    days_before: z.number().int().min(0).max(30).nullable().optional(),
    on_due: z.boolean().optional(),
    every_days_after: z.number().int().min(1).max(60).nullable().optional(),
    max_count: z.number().int().min(1).max(10).optional(),
  })
  .strict()
  .superRefine((policy, context) => {
    if (!policy.enabled) {
      return;
    }
    if (policy.max_count === undefined) {
      context.addIssue({
        code: "custom",
        path: ["max_count"],
        message: "Indica cuántos recordatorios como máximo.",
      });
    }
    const hasMoment =
      policy.days_before != null ||
      policy.on_due === true ||
      policy.every_days_after != null;
    if (!hasMoment) {
      context.addIssue({
        code: "custom",
        path: ["enabled"],
        message: "Elige cuándo enviar los recordatorios.",
      });
    }
  });

export type ReminderPolicy = z.infer<typeof reminderPolicySchema>;

export const DISABLED_POLICY: ReminderPolicy = { enabled: false };

/** Tolerant read of the stored jsonb: anything invalid is «disabled». */
export function parseReminderPolicy(value: unknown): ReminderPolicy {
  const parsed = reminderPolicySchema.safeParse(value);
  return parsed.success ? parsed.data : DISABLED_POLICY;
}

/** Send dates for an invoice due on `dueDate`, in order, at most `max_count`. */
export function reminderDatesFor(
  policy: ReminderPolicy,
  dueDate: string,
): string[] {
  if (!policy.enabled) {
    return [];
  }
  const max = policy.max_count ?? 0;
  const dates: string[] = [];
  if (policy.days_before != null && policy.days_before > 0) {
    dates.push(addCalendarDays(dueDate, -policy.days_before));
  }
  if (policy.on_due === true || policy.days_before === 0) {
    dates.push(dueDate);
  }
  if (policy.every_days_after != null) {
    for (let step = 1; dates.length < max && step <= max; step += 1) {
      dates.push(addCalendarDays(dueDate, policy.every_days_after * step));
    }
  }
  return dates.slice(0, max);
}

export interface DueReminder {
  /** 1-based, also the cap counter (`payment_reminder.sequence`). */
  sequence: number;
  scheduledOn: string;
}

/** The reminder to send today for this invoice, if any. */
export function reminderDueOn(
  policy: ReminderPolicy,
  dueDate: string,
  today: string,
): DueReminder | null {
  const index = reminderDatesFor(policy, dueDate).indexOf(today);
  return index < 0 ? null : { sequence: index + 1, scheduledOn: today };
}

/** Furthest day (after the due date) a policy can still send on. */
export function reminderHorizonDays(policy: ReminderPolicy): number {
  if (!policy.enabled) {
    return 0;
  }
  const dates = reminderDatesFor(policy, "2000-01-01");
  const last = dates.at(-1);
  if (!last) {
    return 0;
  }
  return Math.max(
    0,
    Math.round(
      (Date.parse(`${last}T00:00:00Z`) - Date.parse("2000-01-01T00:00:00Z")) /
        86_400_000,
    ),
  );
}

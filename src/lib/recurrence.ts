/**
 * Dates of recurring invoice cycles (FR-038–040). Pure: dates are
 * `YYYY-MM-DD` strings in Europe/Madrid and never touch the wall clock.
 *
 * Cycle `i` is always computed from the start date (`start + i × step`), not
 * from the previous cycle, so a monthly series starting on the 31st is
 * 31 Jan, 28 Feb, 31 Mar, 30 Apr… and never drifts to the 28th.
 */

export type RecurrenceFrequency =
  | "weekly"
  | "monthly"
  | "quarterly"
  | "semiannual"
  | "annual"
  | "custom";
export type RecurrenceUnit = "day" | "week" | "month";

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  /** Only for `custom`: every N units. */
  intervalCount?: number | null;
  intervalUnit?: RecurrenceUnit | null;
  startOn: string;
  endOn?: string | null;
  maxCycles?: number | null;
}

interface Step {
  count: number;
  unit: RecurrenceUnit;
}

export function stepOf(rule: RecurrenceRule): Step {
  switch (rule.frequency) {
    case "weekly":
      return { count: 1, unit: "week" };
    case "monthly":
      return { count: 1, unit: "month" };
    case "quarterly":
      return { count: 3, unit: "month" };
    case "semiannual":
      return { count: 6, unit: "month" };
    case "annual":
      return { count: 12, unit: "month" };
    case "custom": {
      const count = rule.intervalCount ?? 0;
      if (!Number.isInteger(count) || count < 1 || !rule.intervalUnit) {
        throw new RangeError("La periodicidad personalizada no es válida.");
      }
      return { count, unit: rule.intervalUnit };
    }
  }
}

function parts(date: string): [number, number, number] {
  const [year = 0, month = 0, day = 0] = date.split("-").map(Number);
  return [year, month, day];
}

function format(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Date of cycle `index` (0 = the start date). */
export function cycleDate(rule: RecurrenceRule, index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError("El ciclo debe ser un entero no negativo.");
  }
  const [year, month, day] = parts(rule.startOn);
  const step = stepOf(rule);
  if (step.unit === "month") {
    const total = year * 12 + (month - 1) + step.count * index;
    const targetYear = Math.floor(total / 12);
    const targetMonth = (total % 12) + 1;
    return format(
      targetYear,
      targetMonth,
      Math.min(day, daysInMonth(targetYear, targetMonth)),
    );
  }
  const days = step.count * (step.unit === "week" ? 7 : 1) * index;
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return format(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

/** A rule ends by date or by cycle count, never both (data model). */
export function isCycleWithinEnd(rule: RecurrenceRule, index: number): boolean {
  if (rule.maxCycles != null && index >= rule.maxCycles) {
    return false;
  }
  if (rule.endOn != null && cycleDate(rule, index) > rule.endOn) {
    return false;
  }
  return true;
}

/** Date to run cycle `index`, or `null` once the series is over. */
export function nextRunOn(rule: RecurrenceRule, index: number): string | null {
  return isCycleWithinEnd(rule, index) ? cycleDate(rule, index) : null;
}

/** The series has no cycle left after `generated` cycles. */
export function isFinished(rule: RecurrenceRule, generated: number): boolean {
  return nextRunOn(rule, generated) === null;
}

/**
 * Cycles that are due on `today` and not generated yet, oldest first
 * (several after an outage). `generated` is the number of cycles already
 * claimed, i.e. the next index to run.
 */
export function pendingCycles(
  rule: RecurrenceRule,
  generated: number,
  today: string,
  limit = 100,
): Array<{ index: number; scheduledOn: string }> {
  const pending: Array<{ index: number; scheduledOn: string }> = [];
  for (let index = generated; pending.length < limit; index += 1) {
    const scheduledOn = nextRunOn(rule, index);
    if (scheduledOn === null || scheduledOn > today) {
      break;
    }
    pending.push({ index, scheduledOn });
  }
  return pending;
}

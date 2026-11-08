import { madridDate } from "@/lib/plan";

/** Predefined periods of the period export (FR-032). */
export const EXPORT_PERIODS = [
  "current_month",
  "previous_month",
  "current_quarter",
  "previous_quarter",
  "year",
] as const;
export type ExportPeriod = (typeof EXPORT_PERIODS)[number];

export interface PeriodBounds {
  /** Inclusive `YYYY-MM-DD` dates in Europe/Madrid. */
  from: string;
  to: string;
  /** Stable key: `2026-09`, `2026-Q3` or `2026`. */
  key: string;
  label: string;
}

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const QUARTERS = ["Primer", "Segundo", "Tercer", "Cuarto"];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthBounds(year: number, month: number): PeriodBounds {
  return {
    from: `${year}-${pad(month)}-01`,
    to: `${year}-${pad(month)}-${pad(lastDay(year, month))}`,
    key: `${year}-${pad(month)}`,
    label: `${MONTHS[month - 1]} de ${year}`,
  };
}

export function quarterBounds(year: number, quarter: number): PeriodBounds {
  const firstMonth = (quarter - 1) * 3 + 1;
  const lastMonth = firstMonth + 2;
  return {
    from: `${year}-${pad(firstMonth)}-01`,
    to: `${year}-${pad(lastMonth)}-${pad(lastDay(year, lastMonth))}`,
    key: `${year}-Q${quarter}`,
    label: `${QUARTERS[quarter - 1]} trimestre de ${year}`,
  };
}

/** Resolves a predefined period for the Madrid calendar day of `now`. */
export function resolvePeriod(period: ExportPeriod, now: Date): PeriodBounds {
  const [year, month] = madridDate(now).split("-").map(Number) as [
    number,
    number,
  ];
  const quarter = Math.floor((month - 1) / 3) + 1;
  switch (period) {
    case "current_month":
      return monthBounds(year, month);
    case "previous_month":
      return month === 1
        ? monthBounds(year - 1, 12)
        : monthBounds(year, month - 1);
    case "current_quarter":
      return quarterBounds(year, quarter);
    case "previous_quarter":
      return quarter === 1
        ? quarterBounds(year - 1, 4)
        : quarterBounds(year, quarter - 1);
    case "year":
      return {
        from: `${year}-01-01`,
        to: `${year}-12-31`,
        key: `${year}`,
        label: `año ${year}`,
      };
  }
}

/**
 * Scheduled advisor sends (FR-034): on the first day after a month or
 * quarter closes, the period that just ended; otherwise `null`.
 */
export function closedPeriodOn(
  frequency: "monthly" | "quarterly",
  now: Date,
): PeriodBounds | null {
  const day = Number(madridDate(now).slice(8, 10));
  const month = Number(madridDate(now).slice(5, 7));
  if (day !== 1) {
    return null;
  }
  if (frequency === "quarterly" && (month - 1) % 3 !== 0) {
    return null;
  }
  return resolvePeriod(
    frequency === "monthly" ? "previous_month" : "previous_quarter",
    now,
  );
}

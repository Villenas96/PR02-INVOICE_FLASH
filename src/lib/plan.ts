/**
 * Single versioned source of truth for plans, per-document-type limits and
 * gated features (specs/002 research R2, FR-007–FR-013). API, UI, MCP and
 * jobs read limits and features only from here.
 */

export const PLANS = ["basic", "essential", "pro"] as const;
export type Plan = (typeof PLANS)[number];

export const DOCUMENT_TYPES = [
  "invoice",
  "proforma",
  "receipt",
  "quote",
  "delivery_note",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
/** @deprecated kept for v1 call sites; every document type is issuable. */
export type IssuedDocumentType = DocumentType;
export type DocumentStatus = "draft" | "issued" | "voided";

/** Gated features (FR-012). Everything not listed is available in every plan. */
export const FEATURES = [
  "email",
  "period_export",
  "advanced_export",
  "document_xlsx",
  "advisor_schedule",
  "advisor_access",
  "catalog_import",
  "recurring",
  "reminders",
  "bank_reconciliation",
  "dashboard_full",
  "ai_assistant",
  "full_ui",
] as const;
export type Feature = (typeof FEATURES)[number];

export type UiMode = "simple" | "full";

interface PlanDefinition {
  label: string;
  /** Monthly limit applied to each document type separately. */
  limitPerType: number;
  features: readonly Feature[];
}

const PLAN_DEFINITIONS: Record<Plan, PlanDefinition> = {
  basic: { label: "Básico", limitPerType: 5, features: [] },
  essential: {
    label: "Esencial",
    limitPerType: 100,
    features: ["email", "period_export"],
  },
  // Pro has no commercial limit; 1.000 per type and month is a technical cap
  // against abuse (FR-008).
  pro: { label: "Pro", limitPerType: 1_000, features: FEATURES },
};

export const WARNING_RATIO = 0.8;

export function planLabel(plan: Plan): string {
  return PLAN_DEFINITIONS[plan].label;
}

export function documentLimit(plan: Plan, _documentType: DocumentType): number {
  return PLAN_DEFINITIONS[plan].limitPerType;
}

export function warningThreshold(
  plan: Plan,
  documentType: DocumentType,
): number {
  return Math.ceil(documentLimit(plan, documentType) * WARNING_RATIO);
}

export interface TypeUsage {
  documentType: DocumentType;
  used: number;
  limit: number;
  /** Non-blocking 80 % warning (FR-009). */
  warning: boolean;
  /** Issuing this type is blocked until next month or an upgrade. */
  reached: boolean;
}

export function usageFor(
  plan: Plan,
  documentType: DocumentType,
  used: number,
): TypeUsage {
  const limit = documentLimit(plan, documentType);
  return {
    documentType,
    used,
    limit,
    warning: used >= warningThreshold(plan, documentType),
    reached: used >= limit,
  };
}

export function hasFeature(plan: Plan, feature: Feature): boolean {
  return PLAN_DEFINITIONS[plan].features.includes(feature);
}

export function featuresFor(plan: Plan): Feature[] {
  return FEATURES.filter((feature) => hasFeature(plan, feature));
}

/** Cheapest plan that includes `feature`, for upgrade prompts. */
export function requiredPlanFor(feature: Feature): Plan {
  const plan = PLANS.find((candidate) => hasFeature(candidate, feature));
  if (!plan) {
    throw new Error(`Ningún plan incluye la función ${feature}.`);
  }
  return plan;
}

export function defaultUiMode(plan: Plan): UiMode {
  return hasFeature(plan, "full_ui") ? "full" : "simple";
}

/**
 * Interface actually shown. A stored `full` preference is ignored (never
 * deleted) after a downgrade, so it applies again on upgrade.
 */
export function effectiveUiMode(plan: Plan, preference: UiMode | null): UiMode {
  if (!hasFeature(plan, "full_ui")) {
    return "simple";
  }
  return preference ?? defaultUiMode(plan);
}

const madridPartsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const madridDateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function getPart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): number {
  const value = parts.find((part) => part.type === type)?.value;

  if (!value) {
    throw new Error(
      `No se ha podido obtener la parte ${type} de la fecha de Madrid.`,
    );
  }

  return Number(value);
}

export function madridMidnightAsUtc(
  year: number,
  month: number,
  day: number,
): Date {
  const reference = new Date(Date.UTC(year, month - 1, day));
  const parts = madridDateTimeFormatter.formatToParts(reference);
  const localValueAsUtc = Date.UTC(
    getPart(parts, "year"),
    getPart(parts, "month") - 1,
    getPart(parts, "day"),
    getPart(parts, "hour"),
    getPart(parts, "minute"),
  );

  return new Date(
    reference.getTime() - (localValueAsUtc - reference.getTime()),
  );
}

/** Calendar date (`YYYY-MM-DD`) of `now` in Europe/Madrid. */
export function madridDate(now: Date): string {
  const parts = madridPartsFormatter.formatToParts(now);
  const year = getPart(parts, "year");
  const month = getPart(parts, "month");
  const day = getPart(parts, "day");
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getMadridMonthBounds(now: Date): {
  start: Date;
  endExclusive: Date;
} {
  const parts = madridPartsFormatter.formatToParts(now);
  const year = getPart(parts, "year");
  const month = getPart(parts, "month");
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  return {
    start: madridMidnightAsUtc(year, month, 1),
    endExclusive: madridMidnightAsUtc(nextYear, nextMonth, 1),
  };
}

export function isIssuedDocumentCountable(document: {
  documentType: DocumentType;
  status: DocumentStatus;
}): boolean {
  return document.status === "issued" || document.status === "voided";
}

export function requiresEmissionQuota(input: {
  existingDocumentId?: string;
}): boolean {
  return !input.existingDocumentId;
}

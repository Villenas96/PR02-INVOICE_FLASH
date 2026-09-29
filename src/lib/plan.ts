export type Plan = "free" | "pro";
export type IssuedDocumentType = "invoice" | "proforma" | "receipt";
export type DocumentStatus = "draft" | "issued" | "voided";

export interface PlanCapabilities {
  canGeneratePdf: boolean;
  canSendEmail: boolean;
  canShareLink: boolean;
  docLimit: number;
  warningThreshold: number;
}

const PLAN_CAPABILITIES: Record<Plan, PlanCapabilities> = {
  free: {
    canGeneratePdf: true,
    canSendEmail: false,
    canShareLink: true,
    docLimit: 5,
    warningThreshold: 4,
  },
  pro: {
    canGeneratePdf: true,
    canSendEmail: true,
    canShareLink: true,
    docLimit: 100,
    warningThreshold: 80,
  },
};

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

function madridMidnightAsUtc(year: number, month: number, day: number): Date {
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

export function getPlanCapabilities(plan: Plan): PlanCapabilities {
  return PLAN_CAPABILITIES[plan];
}

export function usageWarning(plan: Plan, issuedDocumentCount: number): boolean {
  return issuedDocumentCount >= getPlanCapabilities(plan).warningThreshold;
}

export function canCreateNewEmission(
  plan: Plan,
  issuedDocumentCount: number,
): boolean {
  return issuedDocumentCount < getPlanCapabilities(plan).docLimit;
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
  documentType: IssuedDocumentType;
  status: DocumentStatus;
}): boolean {
  return document.status === "issued" || document.status === "voided";
}

export function requiresEmissionQuota(input: {
  existingDocumentId?: string;
}): boolean {
  return !input.existingDocumentId;
}

import type { DocumentType } from "@/lib/plan";

/**
 * Conversions between documents (FR-036, research R4). Pure rules: the
 * services enforce them inside their statements.
 */

/** Allowed source → target types; anything else (and any cycle) is refused. */
export const CONVERSION_TARGETS: Readonly<
  Record<DocumentType, readonly DocumentType[]>
> = {
  quote: ["proforma", "delivery_note", "invoice"],
  delivery_note: ["invoice"],
  proforma: ["invoice"],
  invoice: [],
  receipt: [],
};

export type ConversionError =
  | "conversion_not_allowed"
  | "conversion_repeat_confirmation_required";

export interface ConversionCheck {
  source: {
    documentType: DocumentType;
    status: "draft" | "issued" | "voided";
  };
  targetType: DocumentType;
  /** Live documents of `targetType` already converted from this source. */
  existingTargets: number;
  confirmRepeat: boolean;
}

export function canConvert(
  source: DocumentType,
  target: DocumentType,
): boolean {
  return CONVERSION_TARGETS[source].includes(target);
}

/**
 * Only issued, non-voided sources convert, along the transition table.
 * Converting the same source to the same type again needs explicit
 * confirmation (spec Edge Cases; v1 allowed it only once).
 */
export function validateConversion(
  check: ConversionCheck,
): { valid: true } | { valid: false; error: ConversionError } {
  if (
    check.source.status !== "issued" ||
    !canConvert(check.source.documentType, check.targetType)
  ) {
    return { valid: false, error: "conversion_not_allowed" };
  }
  if (check.existingTargets > 0 && !check.confirmRepeat) {
    return { valid: false, error: "conversion_repeat_confirmation_required" };
  }
  return { valid: true };
}

export interface ConversionLineInput {
  description: string;
  quantity: string;
  unitPriceCents: number;
  taxRate: string;
  discountPercentage: string;
  unit?: string | null;
  taxName?: string;
  taxRateId?: string | null;
  catalogItemId?: string | null;
  sectionLabel?: string | null;
}

/** The new document inherits the lines by value, not by reference. */
export function copyLinesForConversion<T extends ConversionLineInput>(
  lines: readonly T[],
): T[] {
  return lines.map((line) => ({ ...line }));
}

export interface DeliveryNoteForInvoice<T extends ConversionLineInput> {
  fullNumber: string;
  issueDate: string;
  lines: readonly T[];
}

function spanishDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

/**
 * Invoicing several delivery notes (US9-AC4): lines are copied by value and
 * labelled «Albarán ALB-0003 (05/09/2026)» to group them per note, in the
 * order the notes were issued.
 */
export function groupDeliveryNoteLines<T extends ConversionLineInput>(
  notes: ReadonlyArray<DeliveryNoteForInvoice<T>>,
): Array<T & { position: number; sectionLabel: string }> {
  const ordered = [...notes].sort((left, right) =>
    left.issueDate === right.issueDate
      ? left.fullNumber.localeCompare(right.fullNumber, "es")
      : left.issueDate.localeCompare(right.issueDate),
  );
  let position = 0;
  return ordered.flatMap((note) =>
    note.lines.map((line) => ({
      ...line,
      position: position++,
      sectionLabel: `Albarán ${note.fullNumber} (${spanishDate(note.issueDate)})`,
    })),
  );
}

export type QuoteState =
  | "pending"
  | "accepted"
  | "rejected"
  | "converted"
  | "expired";

/** Derived at query time, never stored (data-model «Estado derivado»). */
export function deriveQuoteState(input: {
  status: "draft" | "issued" | "voided";
  decision: "accepted" | "rejected" | null;
  validUntil: string | null;
  converted: boolean;
  /** `YYYY-MM-DD` in Europe/Madrid. */
  today: string;
}): QuoteState | null {
  if (input.status !== "issued") {
    return null;
  }
  if (input.converted) {
    return "converted";
  }
  if (input.decision) {
    return input.decision;
  }
  if (input.validUntil !== null && input.validUntil < input.today) {
    return "expired";
  }
  return "pending";
}

export type DeliveryNoteState = "pending" | "invoiced";

/** Invoiced while a live (not released) `invoiced` link exists. */
export function deriveDeliveryNoteState(input: {
  status: "draft" | "issued" | "voided";
  invoiced: boolean;
}): DeliveryNoteState | null {
  if (input.status !== "issued") {
    return null;
  }
  return input.invoiced ? "invoiced" : "pending";
}

export interface ConversionSourceDocument {
  documentType: "invoice" | "proforma" | "receipt";
  status: "draft" | "issued" | "voided";
  convertedToId: string | null;
}

export type ConversionValidationError =
  | "already_converted"
  | "not_a_proforma"
  | "not_issued";

/** A proforma converts to an invoice at most once (FR-016). */
export function validateConversionSource(
  document: ConversionSourceDocument,
): { valid: false; error: ConversionValidationError } | { valid: true } {
  if (document.documentType !== "proforma") {
    return { valid: false, error: "not_a_proforma" };
  }
  if (document.status !== "issued") {
    return { valid: false, error: "not_issued" };
  }
  if (document.convertedToId) {
    return { valid: false, error: "already_converted" };
  }
  return { valid: true };
}

export interface ConversionLineInput {
  description: string;
  quantity: string;
  unitPriceCents: number;
  taxRate: string;
  discountPercentage: string;
}

/** The new invoice inherits the proforma's lines by value, not by reference. */
export function copyLinesForConversion(
  lines: readonly ConversionLineInput[],
): ConversionLineInput[] {
  return lines.map((line) => ({ ...line }));
}

export type ConversionCreationDecision =
  | { action: "create_draft" }
  | { action: "reuse_existing"; documentId: string };

/**
 * A proforma links to at most one converted invoice (`converted_to_id`).
 * Converting again — draft mode or direct-issue — always resolves that same
 * invoice instead of creating a second one.
 */
export function decideConversionCreation(
  convertedToId: string | null,
): ConversionCreationDecision {
  return convertedToId
    ? { action: "reuse_existing", documentId: convertedToId }
    : { action: "create_draft" };
}

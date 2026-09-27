export interface ReceiptTotals {
  subtotalCents: number;
  taxBreakdown: [];
  retentionRate: string;
  retentionCents: number;
  totalCents: number;
}

/** A receipt copies the payment's exact amount with zero fiscal base/tax/retention. */
export function buildReceiptTotals(paymentAmountCents: number): ReceiptTotals {
  return {
    subtotalCents: 0,
    taxBreakdown: [],
    retentionRate: "0.00",
    retentionCents: 0,
    totalCents: paymentAmountCents,
  };
}

export interface ReceiptSourceInvoice {
  documentType: "invoice" | "proforma" | "receipt";
  status: "draft" | "issued" | "voided";
}

export interface ReceiptSourcePayment {
  documentId: string;
}

export type ReceiptValidationError =
  | "not_an_invoice"
  | "not_issued"
  | "payment_mismatch";

/** A receipt only justifies a payment on its own issued invoice (US6-AC3). */
export function validateReceiptSource(
  invoiceId: string,
  invoice: ReceiptSourceInvoice,
  payment: ReceiptSourcePayment,
): { error: ReceiptValidationError; valid: false } | { valid: true } {
  if (invoice.documentType !== "invoice") {
    return { valid: false, error: "not_an_invoice" };
  }
  if (invoice.status !== "issued") {
    return { valid: false, error: "not_issued" };
  }
  if (payment.documentId !== invoiceId) {
    return { valid: false, error: "payment_mismatch" };
  }
  return { valid: true };
}

export type ReceiptCreationDecision =
  | { action: "create_new" }
  | { action: "issue_existing"; documentId: string };

/**
 * At most one receipt exists per payment (`document_payment_receipt_unique`).
 * Resolving an existing receipt always happens before any quota check, so a
 * replay never consumes another plan slot (FR-027).
 */
export function decideReceiptCreation(
  existingReceiptId: string | null,
): ReceiptCreationDecision {
  return existingReceiptId
    ? { action: "issue_existing", documentId: existingReceiptId }
    : { action: "create_new" };
}

export type PaymentStatus = "overdue" | "paid" | "partial" | "pending";

export interface PaymentStatusInput {
  documentStatus: "draft" | "issued" | "voided";
  documentType: "invoice" | "proforma" | "receipt";
  totalCents: number;
  paidCents: number;
  /** `YYYY-MM-DD`, or `null` when the invoice has no due date. */
  dueDate: string | null;
  /** `YYYY-MM-DD` in `Europe/Madrid`, the calendar day the status is derived for. */
  today: string;
}

/**
 * Collection status is derived at query time, never stored (FR-024). Only
 * issued invoices participate; proformas, receipts, drafts and voided
 * documents never carry a collection status.
 */
export function derivePaymentStatus(
  input: PaymentStatusInput,
): PaymentStatus | null {
  if (input.documentStatus !== "issued" || input.documentType !== "invoice") {
    return null;
  }
  if (input.paidCents >= input.totalCents) {
    return "paid";
  }
  if (input.dueDate !== null && input.dueDate < input.today) {
    return "overdue";
  }
  if (input.paidCents > 0) {
    return "partial";
  }
  return "pending";
}

export function outstandingCents(
  totalCents: number,
  paidCents: number,
): number {
  return Math.max(totalCents - paidCents, 0);
}

/**
 * A payment requires explicit `confirmed_overpayment` when it would exceed
 * the outstanding balance, even by a single cent.
 */
export function isOverpayment(input: {
  totalCents: number;
  paidCents: number;
  amountCents: number;
}): boolean {
  return (
    input.amountCents > outstandingCents(input.totalCents, input.paidCents)
  );
}

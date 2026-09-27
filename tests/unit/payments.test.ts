import { describe, expect, it } from "vitest";

import {
  derivePaymentStatus,
  isOverpayment,
  outstandingCents,
} from "@/lib/payments";

const issuedInvoice = {
  documentStatus: "issued" as const,
  documentType: "invoice" as const,
  totalCents: 10_000,
  today: "2026-09-26",
};

describe("derivePaymentStatus", () => {
  it("classifies a fully unpaid invoice without a due date as pending", () => {
    expect(
      derivePaymentStatus({ ...issuedInvoice, paidCents: 0, dueDate: null }),
    ).toBe("pending");
  });

  it("classifies a fully unpaid invoice due today as pending, not overdue", () => {
    expect(
      derivePaymentStatus({
        ...issuedInvoice,
        paidCents: 0,
        dueDate: "2026-09-26",
      }),
    ).toBe("pending");
  });

  it("classifies a fully unpaid invoice one day past due as overdue", () => {
    expect(
      derivePaymentStatus({
        ...issuedInvoice,
        paidCents: 0,
        dueDate: "2026-09-25",
      }),
    ).toBe("overdue");
  });

  it("classifies a partially paid invoice not yet due as partial", () => {
    expect(
      derivePaymentStatus({
        ...issuedInvoice,
        paidCents: 4_000,
        dueDate: "2026-09-30",
      }),
    ).toBe("partial");
  });

  it("classifies a partially paid invoice past its due date as overdue", () => {
    expect(
      derivePaymentStatus({
        ...issuedInvoice,
        paidCents: 4_000,
        dueDate: "2026-09-25",
      }),
    ).toBe("overdue");
  });

  it("classifies a fully paid invoice as paid regardless of due date", () => {
    expect(
      derivePaymentStatus({
        ...issuedInvoice,
        paidCents: 10_000,
        dueDate: "2026-09-01",
      }),
    ).toBe("paid");
  });

  it("classifies an overpaid invoice as paid", () => {
    expect(
      derivePaymentStatus({
        ...issuedInvoice,
        paidCents: 12_000,
        dueDate: "2026-09-01",
      }),
    ).toBe("paid");
  });

  it("excludes voided invoices from every collection status", () => {
    expect(
      derivePaymentStatus({
        ...issuedInvoice,
        documentStatus: "voided",
        paidCents: 4_000,
        dueDate: "2026-09-01",
      }),
    ).toBeNull();
  });

  it("excludes draft documents", () => {
    expect(
      derivePaymentStatus({
        ...issuedInvoice,
        documentStatus: "draft",
        paidCents: 0,
        dueDate: null,
      }),
    ).toBeNull();
  });

  it("excludes issued proformas and receipts, which never derive a collection status", () => {
    expect(
      derivePaymentStatus({
        ...issuedInvoice,
        documentType: "proforma",
        paidCents: 0,
        dueDate: "2026-09-01",
      }),
    ).toBeNull();
    expect(
      derivePaymentStatus({
        ...issuedInvoice,
        documentType: "receipt",
        paidCents: 10_000,
        dueDate: null,
      }),
    ).toBeNull();
  });
});

describe("outstandingCents", () => {
  it("returns the difference between total and paid", () => {
    expect(outstandingCents(10_000, 4_000)).toBe(6_000);
  });

  it("never returns a negative amount for an overpaid invoice", () => {
    expect(outstandingCents(10_000, 12_000)).toBe(0);
  });

  it("returns zero once the invoice is fully paid", () => {
    expect(outstandingCents(10_000, 10_000)).toBe(0);
  });
});

describe("isOverpayment", () => {
  it("is false when the new amount exactly settles the outstanding balance", () => {
    expect(
      isOverpayment({
        totalCents: 10_000,
        paidCents: 4_000,
        amountCents: 6_000,
      }),
    ).toBe(false);
  });

  it("is false when the new amount is less than the outstanding balance", () => {
    expect(
      isOverpayment({
        totalCents: 10_000,
        paidCents: 4_000,
        amountCents: 1_000,
      }),
    ).toBe(false);
  });

  it("is true when the new amount exceeds the outstanding balance by even one cent", () => {
    expect(
      isOverpayment({
        totalCents: 10_000,
        paidCents: 4_000,
        amountCents: 6_001,
      }),
    ).toBe(true);
  });

  it("is true when the invoice already has no outstanding balance", () => {
    expect(
      isOverpayment({ totalCents: 10_000, paidCents: 10_000, amountCents: 1 }),
    ).toBe(true);
  });
});

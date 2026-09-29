import { describe, expect, it } from "vitest";

import {
  buildReceiptTotals,
  decideReceiptCreation,
  validateReceiptSource,
} from "@/lib/documents/receipts";

describe("buildReceiptTotals", () => {
  it("copies the exact payment amount with a zero fiscal base, tax and retention", () => {
    expect(buildReceiptTotals(12_345)).toEqual({
      subtotalCents: 0,
      taxBreakdown: [],
      retentionRate: "0.00",
      retentionCents: 0,
      totalCents: 12_345,
    });
  });

  it("still copies a zero-amount payment exactly", () => {
    expect(buildReceiptTotals(0).totalCents).toBe(0);
  });
});

describe("validateReceiptSource", () => {
  const issuedInvoice = {
    documentType: "invoice" as const,
    status: "issued" as const,
  };

  it("accepts a payment on its own issued invoice", () => {
    expect(
      validateReceiptSource("invoice-1", issuedInvoice, {
        documentId: "invoice-1",
      }),
    ).toEqual({ valid: true });
  });

  it("rejects a proforma or receipt as the receipt source", () => {
    expect(
      validateReceiptSource(
        "doc-1",
        { documentType: "proforma", status: "issued" },
        { documentId: "doc-1" },
      ),
    ).toEqual({ valid: false, error: "not_an_invoice" });
  });

  it("rejects an invoice that has not been issued", () => {
    expect(
      validateReceiptSource(
        "invoice-1",
        { documentType: "invoice", status: "draft" },
        { documentId: "invoice-1" },
      ),
    ).toEqual({ valid: false, error: "not_issued" });
  });

  it("rejects a payment that belongs to a different document", () => {
    expect(
      validateReceiptSource("invoice-1", issuedInvoice, {
        documentId: "invoice-2",
      }),
    ).toEqual({ valid: false, error: "payment_mismatch" });
  });
});

describe("decideReceiptCreation", () => {
  it("creates a new receipt the first time a payment is receipted", () => {
    expect(decideReceiptCreation(null)).toEqual({ action: "create_new" });
  });

  it("resolves the existing receipt for any later attempt on the same payment", () => {
    expect(decideReceiptCreation("receipt-1")).toEqual({
      action: "issue_existing",
      documentId: "receipt-1",
    });
  });
});

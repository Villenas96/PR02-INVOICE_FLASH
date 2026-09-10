import { describe, expect, it } from "vitest";

import {
  canCreateNewEmission,
  getMadridMonthBounds,
  getPlanCapabilities,
  isIssuedDocumentCountable,
  requiresEmissionQuota,
  usageWarning,
} from "@/lib/plan";

describe("plan capabilities", () => {
  it("defines the versioned free and pro capabilities", () => {
    expect(getPlanCapabilities("free")).toMatchObject({
      canSendEmail: false,
      canGeneratePdf: true,
      canShareLink: true,
      docLimit: 5,
      warningThreshold: 4,
    });
    expect(getPlanCapabilities("pro")).toMatchObject({
      canSendEmail: true,
      docLimit: 100,
      warningThreshold: 80,
    });
  });

  it("warns at 4 free documents and 80 pro documents", () => {
    expect(usageWarning("free", 3)).toBe(false);
    expect(usageWarning("free", 4)).toBe(true);
    expect(usageWarning("pro", 79)).toBe(false);
    expect(usageWarning("pro", 80)).toBe(true);
  });

  it("uses Madrid calendar-month UTC bounds across daylight-saving changes", () => {
    expect(getMadridMonthBounds(new Date("2026-03-31T22:30:00.000Z"))).toEqual({
      start: new Date("2026-03-31T22:00:00.000Z"),
      endExclusive: new Date("2026-04-30T22:00:00.000Z"),
    });
  });

  it("counts every emitted type, including later voids, but never drafts", () => {
    expect(
      isIssuedDocumentCountable({ documentType: "invoice", status: "issued" }),
    ).toBe(true);
    expect(
      isIssuedDocumentCountable({ documentType: "proforma", status: "voided" }),
    ).toBe(true);
    expect(
      isIssuedDocumentCountable({ documentType: "receipt", status: "issued" }),
    ).toBe(true);
    expect(
      isIssuedDocumentCountable({ documentType: "invoice", status: "draft" }),
    ).toBe(false);
  });

  it("does not charge quota again when resolving an existing idempotent result", () => {
    expect(
      requiresEmissionQuota({ existingDocumentId: "existing-document" }),
    ).toBe(false);
    expect(requiresEmissionQuota({})).toBe(true);
    expect(canCreateNewEmission("free", 5)).toBe(false);
    expect(canCreateNewEmission("pro", 99)).toBe(true);
    expect(canCreateNewEmission("pro", 100)).toBe(false);
  });
});

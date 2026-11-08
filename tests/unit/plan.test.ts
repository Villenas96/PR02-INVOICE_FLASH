import { describe, expect, it } from "vitest";

import {
  DOCUMENT_TYPES,
  defaultUiMode,
  documentLimit,
  effectiveUiMode,
  FEATURES,
  type Feature,
  featuresFor,
  getMadridMonthBounds,
  hasFeature,
  isIssuedDocumentCountable,
  type Plan,
  planLabel,
  requiredPlanFor,
  requiresEmissionQuota,
  usageFor,
  warningThreshold,
} from "@/lib/plan";

describe("plans and per-document-type limits", () => {
  it.each<[Plan, number]>([
    ["basic", 5],
    ["essential", 100],
    ["pro", 1_000],
  ])("limits %s to %i documents of every type", (plan, limit) => {
    for (const documentType of DOCUMENT_TYPES) {
      expect(documentLimit(plan, documentType)).toBe(limit);
    }
  });

  it("warns at ceil(limit * 0.8) per type", () => {
    expect(warningThreshold("basic", "invoice")).toBe(4);
    expect(warningThreshold("essential", "proforma")).toBe(80);
    expect(warningThreshold("pro", "quote")).toBe(800);
  });

  it("derives usage, warning and limit reached per type independently", () => {
    expect(usageFor("basic", "invoice", 3)).toEqual({
      documentType: "invoice",
      used: 3,
      limit: 5,
      warning: false,
      reached: false,
    });
    expect(usageFor("basic", "invoice", 4)).toMatchObject({
      warning: true,
      reached: false,
    });
    expect(usageFor("basic", "invoice", 5)).toMatchObject({
      warning: true,
      reached: true,
    });
    expect(usageFor("basic", "proforma", 0)).toMatchObject({
      used: 0,
      warning: false,
      reached: false,
    });
  });

  it("names plans in Spanish", () => {
    expect(planLabel("basic")).toBe("Básico");
    expect(planLabel("essential")).toBe("Esencial");
    expect(planLabel("pro")).toBe("Pro");
  });
});

describe("features (FR-012)", () => {
  const essentialFeatures: Feature[] = ["email", "period_export"];

  it("gives Basic no gated feature", () => {
    for (const feature of FEATURES) {
      expect(hasFeature("basic", feature)).toBe(false);
    }
    expect(featuresFor("basic")).toEqual([]);
  });

  it("gives Essential email and the period export only", () => {
    for (const feature of FEATURES) {
      expect(hasFeature("essential", feature)).toBe(
        essentialFeatures.includes(feature),
      );
    }
  });

  it("gives Pro every feature", () => {
    for (const feature of FEATURES) {
      expect(hasFeature("pro", feature)).toBe(true);
    }
    expect(featuresFor("pro")).toEqual([...FEATURES]);
  });

  it("reports the cheapest plan that includes each feature", () => {
    expect(requiredPlanFor("email")).toBe("essential");
    expect(requiredPlanFor("period_export")).toBe("essential");
    expect(requiredPlanFor("recurring")).toBe("pro");
    expect(requiredPlanFor("full_ui")).toBe("pro");
  });
});

describe("interface mode", () => {
  it("defaults to simple for Basic/Essential and full for Pro", () => {
    expect(defaultUiMode("basic")).toBe("simple");
    expect(defaultUiMode("essential")).toBe("simple");
    expect(defaultUiMode("pro")).toBe("full");
  });

  it("only lets Pro use the full interface and ignores a stale preference", () => {
    expect(effectiveUiMode("pro", null)).toBe("full");
    expect(effectiveUiMode("pro", "simple")).toBe("simple");
    expect(effectiveUiMode("essential", "full")).toBe("simple");
    expect(effectiveUiMode("basic", null)).toBe("simple");
  });
});

describe("quota counting rules (v1, unchanged)", () => {
  it("uses Madrid calendar-month UTC bounds across daylight-saving changes", () => {
    expect(getMadridMonthBounds(new Date("2026-03-31T22:30:00.000Z"))).toEqual({
      start: new Date("2026-03-31T22:00:00.000Z"),
      endExclusive: new Date("2026-04-30T22:00:00.000Z"),
    });
    expect(getMadridMonthBounds(new Date("2026-10-31T23:30:00.000Z"))).toEqual({
      start: new Date("2026-10-31T23:00:00.000Z"),
      endExclusive: new Date("2026-11-30T23:00:00.000Z"),
    });
  });

  it("counts emitted documents, including later voids, but never drafts", () => {
    expect(
      isIssuedDocumentCountable({ documentType: "quote", status: "issued" }),
    ).toBe(true);
    expect(
      isIssuedDocumentCountable({
        documentType: "delivery_note",
        status: "voided",
      }),
    ).toBe(true);
    expect(
      isIssuedDocumentCountable({ documentType: "invoice", status: "draft" }),
    ).toBe(false);
  });

  it("does not charge quota again for an existing idempotent result", () => {
    expect(
      requiresEmissionQuota({ existingDocumentId: "existing-document" }),
    ).toBe(false);
    expect(requiresEmissionQuota({})).toBe(true);
  });
});

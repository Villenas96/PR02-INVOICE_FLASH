import { describe, expect, it } from "vitest";

import {
  CONVERSION_TARGETS,
  canConvert,
  copyLinesForConversion,
  deriveDeliveryNoteState,
  deriveQuoteState,
  groupDeliveryNoteLines,
  validateConversion,
} from "@/lib/documents/conversion";
import { DOCUMENT_TYPES } from "@/lib/plan";

const issued = (documentType: "quote" | "delivery_note" | "proforma") => ({
  documentType,
  status: "issued" as const,
});

describe("conversion transition table", () => {
  it.each([
    ["quote", "proforma"],
    ["quote", "delivery_note"],
    ["quote", "invoice"],
    ["delivery_note", "invoice"],
    ["proforma", "invoice"],
  ] as const)("allows %s → %s", (source, target) => {
    expect(canConvert(source, target)).toBe(true);
  });

  it("forbids every other pair, including cycles back to a source type", () => {
    const allowed = new Set(
      Object.entries(CONVERSION_TARGETS).flatMap(([source, targets]) =>
        targets.map((target) => `${source}>${target}`),
      ),
    );
    for (const source of DOCUMENT_TYPES) {
      for (const target of DOCUMENT_TYPES) {
        expect(canConvert(source, target)).toBe(
          allowed.has(`${source}>${target}`),
        );
      }
    }
    expect(canConvert("invoice", "quote")).toBe(false);
    expect(canConvert("delivery_note", "quote")).toBe(false);
    expect(canConvert("proforma", "delivery_note")).toBe(false);
    expect(canConvert("quote", "quote")).toBe(false);
  });
});

describe("validateConversion", () => {
  it("accepts an issued source along the table", () => {
    expect(
      validateConversion({
        source: issued("quote"),
        targetType: "delivery_note",
        existingTargets: 0,
        confirmRepeat: false,
      }),
    ).toEqual({ valid: true });
  });

  it.each(["draft", "voided"] as const)("refuses a %s source", (status) => {
    expect(
      validateConversion({
        source: { documentType: "proforma", status },
        targetType: "invoice",
        existingTargets: 0,
        confirmRepeat: true,
      }),
    ).toEqual({ valid: false, error: "conversion_not_allowed" });
  });

  it("refuses a pair outside the table", () => {
    expect(
      validateConversion({
        source: issued("delivery_note"),
        targetType: "proforma",
        existingTargets: 0,
        confirmRepeat: false,
      }),
    ).toEqual({ valid: false, error: "conversion_not_allowed" });
  });

  it("asks for confirmation to convert to the same type again", () => {
    const repeat = {
      source: issued("proforma"),
      targetType: "invoice" as const,
      existingTargets: 1,
    };
    expect(validateConversion({ ...repeat, confirmRepeat: false })).toEqual({
      valid: false,
      error: "conversion_repeat_confirmation_required",
    });
    expect(validateConversion({ ...repeat, confirmRepeat: true })).toEqual({
      valid: true,
    });
  });
});

describe("line copies", () => {
  const line = {
    description: "Hora",
    quantity: "1",
    unitPriceCents: 4_500,
    taxRate: "21.00",
    discountPercentage: "0",
    unit: "hora",
  };

  it("copies lines by value", () => {
    const copies = copyLinesForConversion([line]);
    expect(copies).toEqual([line]);
    expect(copies[0]).not.toBe(line);
  });

  it("groups delivery note lines per note, ordered by issue date", () => {
    const grouped = groupDeliveryNoteLines([
      {
        fullNumber: "ALB-0004",
        issueDate: "2026-09-10",
        lines: [{ ...line, description: "Montaje" }],
      },
      {
        fullNumber: "ALB-0003",
        issueDate: "2026-09-05",
        lines: [line, { ...line, description: "Transporte" }],
      },
    ]);
    expect(
      grouped.map(({ position, description, sectionLabel }) => ({
        position,
        description,
        sectionLabel,
      })),
    ).toEqual([
      {
        position: 0,
        description: "Hora",
        sectionLabel: "Albarán ALB-0003 (05/09/2026)",
      },
      {
        position: 1,
        description: "Transporte",
        sectionLabel: "Albarán ALB-0003 (05/09/2026)",
      },
      {
        position: 2,
        description: "Montaje",
        sectionLabel: "Albarán ALB-0004 (10/09/2026)",
      },
    ]);
  });
});

describe("derived states", () => {
  const base = {
    status: "issued" as const,
    decision: null,
    validUntil: "2026-10-31",
    converted: false,
    today: "2026-10-20",
  };

  it.each([
    [{}, "pending"],
    [{ decision: "accepted" as const }, "accepted"],
    [{ decision: "rejected" as const }, "rejected"],
    [{ validUntil: "2026-10-19" }, "expired"],
    [{ validUntil: "2026-10-20" }, "pending"],
    [{ validUntil: null }, "pending"],
    [{ converted: true, decision: "accepted" as const }, "converted"],
    [{ converted: true, validUntil: "2026-01-01" }, "converted"],
    [{ status: "voided" as const }, null],
    [{ status: "draft" as const }, null],
  ])("quote %j → %s", (overrides, expected) => {
    expect(deriveQuoteState({ ...base, ...overrides })).toBe(expected);
  });

  it("derives delivery note states", () => {
    expect(deriveDeliveryNoteState({ status: "issued", invoiced: false })).toBe(
      "pending",
    );
    expect(deriveDeliveryNoteState({ status: "issued", invoiced: true })).toBe(
      "invoiced",
    );
    expect(deriveDeliveryNoteState({ status: "voided", invoiced: false })).toBe(
      null,
    );
  });
});

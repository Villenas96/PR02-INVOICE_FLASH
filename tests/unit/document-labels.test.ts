import { describe, expect, it } from "vitest";

import { CREATABLE_DOCUMENT_TYPES } from "@/lib/documents/creatable";
import {
  DUPLICATE_WARNING_TEXTS,
  duplicateWarningTexts,
} from "@/lib/documents/duplicate-warnings";
import { documentTypeLabel, documentTypePlural } from "@/lib/documents/labels";

describe("document type labels", () => {
  it("names each type in Spanish, singular and plural", () => {
    expect(documentTypeLabel("delivery_note")).toBe("Albarán");
    expect(documentTypePlural("delivery_note")).toBe("albaranes");
    expect(documentTypeLabel("quote")).toBe("Presupuesto");
    expect(documentTypePlural("invoice")).toBe("facturas");
  });

  it("does not let the editor create receipts directly", () => {
    expect(CREATABLE_DOCUMENT_TYPES).not.toContain("receipt");
    expect(CREATABLE_DOCUMENT_TYPES).toContain("invoice");
  });
});

describe("duplicateWarningTexts", () => {
  it("maps known warning codes in order and skips unknown ones", () => {
    expect(
      duplicateWarningTexts("client_archived,unknown,tax_archived"),
    ).toEqual([
      DUPLICATE_WARNING_TEXTS.client_archived,
      DUPLICATE_WARNING_TEXTS.tax_archived,
    ]);
  });

  it("returns nothing for non-string values", () => {
    expect(duplicateWarningTexts(undefined)).toEqual([]);
    expect(duplicateWarningTexts(["client_archived"])).toEqual([]);
  });
});

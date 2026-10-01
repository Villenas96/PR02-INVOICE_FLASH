import { describe, expect, it } from "vitest";

import {
  buildClientSnapshot,
  buildIssuerSnapshot,
  getCompanyReadiness,
  getDocumentTransition,
  validateDocumentLine,
  validateIssue,
} from "@/lib/documents";

const readyCompany = {
  legalName: "Estudio Norte, S.L.",
  taxId: "B12345678",
  address: "Calle Mayor 1, 28013 Madrid",
};

const validLine = {
  description: "Consultoría técnica",
  quantity: 1,
  unitPriceCents: 12_500,
  taxRate: 21,
  discountPct: 0,
};

describe("document issue readiness", () => {
  it("reports every missing fiscal issuer field in a stable order", () => {
    expect(
      getCompanyReadiness({
        legalName: " ",
        taxId: "",
        address: "\n",
      }),
    ).toEqual({
      ready: false,
      missingFields: ["legalName", "taxId", "address"],
    });
  });

  it("requires only the minimum fiscal issuer fields for the first issue", () => {
    expect(getCompanyReadiness(readyCompany)).toEqual({
      ready: true,
      missingFields: [],
    });
  });

  it("returns concrete errors for an incomplete issue attempt", () => {
    expect(
      validateIssue({
        company: { legalName: "", taxId: "", address: "" },
        clientId: null,
        lines: [],
      }),
    ).toEqual({
      valid: false,
      errors: [
        {
          code: "issuer_legal_name_required",
          field: "company.legalName",
        },
        { code: "issuer_tax_id_required", field: "company.taxId" },
        { code: "issuer_address_required", field: "company.address" },
        { code: "client_required", field: "clientId" },
        { code: "lines_required", field: "lines" },
      ],
    });
  });

  it("returns the indexed field error for an invalid document line", () => {
    expect(
      validateIssue({
        company: readyCompany,
        clientId: "client-1",
        lines: [{ ...validLine, quantity: 0 }],
      }),
    ).toEqual({
      valid: false,
      errors: [
        {
          code: "quantity_must_be_positive",
          field: "lines.0.quantity",
        },
      ],
    });
  });

  it("requires the client tax id and address to issue an invoice", () => {
    expect(
      validateIssue({
        documentType: "invoice",
        company: readyCompany,
        clientId: "client-1",
        client: { taxId: " ", address: null },
        lines: [validLine],
      }),
    ).toEqual({
      valid: false,
      errors: [
        { code: "client_tax_id_required", field: "client.taxId" },
        { code: "client_address_required", field: "client.address" },
      ],
    });
  });

  it("does not require client fiscal data to issue a proforma", () => {
    expect(
      validateIssue({
        documentType: "proforma",
        company: readyCompany,
        clientId: "client-1",
        client: { taxId: null, address: null },
        lines: [validLine],
      }),
    ).toEqual({ valid: true, errors: [] });
  });

  it("accepts an invoice whose client has tax id and address", () => {
    expect(
      validateIssue({
        documentType: "invoice",
        company: readyCompany,
        clientId: "client-1",
        client: { taxId: "B12345678", address: "Calle Mayor 1, Madrid" },
        lines: [validLine],
      }),
    ).toEqual({ valid: true, errors: [] });
  });

  it("accepts an issue-ready invoice", () => {
    expect(
      validateIssue({
        company: readyCompany,
        clientId: "client-1",
        lines: [validLine],
      }),
    ).toEqual({ valid: true, errors: [] });
  });
});

describe("document lifecycle", () => {
  it("transitions drafts to issued and issued documents to voided", () => {
    expect(getDocumentTransition("draft", "issue")).toEqual({
      allowed: true,
      nextStatus: "issued",
    });
    expect(getDocumentTransition("issued", "void")).toEqual({
      allowed: true,
      nextStatus: "voided",
    });
  });

  it("does not issue a document that is no longer a draft", () => {
    expect(getDocumentTransition("issued", "issue")).toEqual({
      allowed: false,
      code: "document_not_draft",
      currentStatus: "issued",
    });
  });

  it("does not void a draft", () => {
    expect(getDocumentTransition("draft", "void")).toEqual({
      allowed: false,
      code: "document_not_issued",
      currentStatus: "draft",
    });
  });

  it("treats a voided document as a terminal state", () => {
    expect(getDocumentTransition("voided", "issue")).toEqual({
      allowed: false,
      code: "voided_document_is_terminal",
      currentStatus: "voided",
    });
    expect(getDocumentTransition("voided", "void")).toEqual({
      allowed: false,
      code: "voided_document_is_terminal",
      currentStatus: "voided",
    });
  });
});

describe("issued document snapshots", () => {
  it("copies only issuer data needed by an issued document", () => {
    const issuer = {
      id: "company-1",
      legalName: "Estudio Norte, S.L.",
      taxId: "B12345678",
      address: "Calle Mayor 1, 28013 Madrid",
      email: "facturacion@example.com",
      phone: null,
      logoKey: "companies/company-1/logo.svg",
    };

    const snapshot = buildIssuerSnapshot(issuer);

    expect(snapshot).toEqual({
      legalName: "Estudio Norte, S.L.",
      taxId: "B12345678",
      address: "Calle Mayor 1, 28013 Madrid",
      email: "facturacion@example.com",
      phone: null,
      logoKey: "companies/company-1/logo.svg",
    });
    expect(snapshot).not.toHaveProperty("id");

    issuer.legalName = "Nombre cambiado";
    issuer.taxId = "A00000000";
    issuer.address = "Otra dirección";

    expect(snapshot).toMatchObject({
      legalName: "Estudio Norte, S.L.",
      taxId: "B12345678",
      address: "Calle Mayor 1, 28013 Madrid",
    });
  });

  it("copies client fiscal data without retaining its mutable record identity", () => {
    const client = {
      id: "client-1",
      name: "Cliente Ejemplo, S.A.",
      taxId: "A87654321",
      address: "Avenida del Mar 5, Valencia",
      email: null,
      phone: "+34 600 000 000",
    };

    const snapshot = buildClientSnapshot(client);

    expect(snapshot).toEqual({
      name: "Cliente Ejemplo, S.A.",
      taxId: "A87654321",
      address: "Avenida del Mar 5, Valencia",
      email: null,
      phone: "+34 600 000 000",
    });
    expect(snapshot).not.toHaveProperty("id");

    client.name = "Cliente editado";
    client.address = "Dirección editada";

    expect(snapshot).toMatchObject({
      name: "Cliente Ejemplo, S.A.",
      address: "Avenida del Mar 5, Valencia",
    });
  });
});

describe("document line validation", () => {
  it.each([
    {
      name: "a blank description",
      line: { ...validLine, description: " \n" },
      fieldErrors: { description: "description_required" },
    },
    {
      name: "zero quantity",
      line: { ...validLine, quantity: 0 },
      fieldErrors: { quantity: "quantity_must_be_positive" },
    },
    {
      name: "negative quantity",
      line: { ...validLine, quantity: -0.001 },
      fieldErrors: { quantity: "quantity_must_be_positive" },
    },
    {
      name: "a negative cent price",
      line: { ...validLine, unitPriceCents: -1 },
      fieldErrors: {
        unitPriceCents: "unit_price_cents_must_be_non_negative_integer",
      },
    },
    {
      name: "a fractional cent price",
      line: { ...validLine, unitPriceCents: 1.5 },
      fieldErrors: {
        unitPriceCents: "unit_price_cents_must_be_non_negative_integer",
      },
    },
    {
      name: "a discount below zero",
      line: { ...validLine, discountPct: -0.01 },
      fieldErrors: { discountPct: "discount_pct_out_of_range" },
    },
    {
      name: "a discount above one hundred",
      line: { ...validLine, discountPct: 100.01 },
      fieldErrors: { discountPct: "discount_pct_out_of_range" },
    },
    {
      name: "a tax rate below zero",
      line: { ...validLine, taxRate: -0.01 },
      fieldErrors: { taxRate: "tax_rate_out_of_range" },
    },
    {
      name: "a tax rate of one hundred",
      line: { ...validLine, taxRate: 100 },
      fieldErrors: { taxRate: "tax_rate_out_of_range" },
    },
  ])("rejects $name", ({ line, fieldErrors }) => {
    expect(validateDocumentLine(line)).toEqual({
      valid: false,
      fieldErrors,
    });
  });

  it("accepts zero-priced and fully discounted lines at valid tax rates", () => {
    expect(
      validateDocumentLine({
        ...validLine,
        unitPriceCents: 0,
        taxRate: 0,
        discountPct: 100,
      }),
    ).toEqual({ valid: true, fieldErrors: {} });
  });
});

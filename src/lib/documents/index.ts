export type CompanyReadinessField = "legalName" | "taxId" | "address";

export interface CompanyFiscalDetails {
  legalName?: string | null;
  taxId?: string | null;
  address?: string | null;
}

export interface CompanyReadiness {
  ready: boolean;
  missingFields: CompanyReadinessField[];
}

export type DocumentStatus = "draft" | "issued" | "voided";
export type DocumentLifecycleAction = "issue" | "void";

export type DocumentTransition =
  | {
      allowed: true;
      nextStatus: "issued" | "voided";
    }
  | {
      allowed: false;
      code:
        | "document_not_draft"
        | "document_not_issued"
        | "voided_document_is_terminal";
      currentStatus: DocumentStatus;
    };

export interface IssuerSnapshotInput {
  legalName: string;
  taxId: string;
  address: string;
  email: string;
  phone: string | null;
  logoKey: string | null;
}

export type IssuerSnapshot = Readonly<IssuerSnapshotInput>;

export interface ClientSnapshotInput {
  name: string;
  taxId: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
}

export type ClientSnapshot = Readonly<ClientSnapshotInput>;

export interface DocumentLineInput {
  description: string;
  quantity: number;
  unitPriceCents: number;
  taxRate: number;
  discountPct: number;
}

export type DocumentLineField = keyof DocumentLineInput;

export type DocumentLineErrorCode =
  | "description_required"
  | "quantity_must_be_positive"
  | "unit_price_cents_must_be_non_negative_integer"
  | "tax_rate_out_of_range"
  | "discount_pct_out_of_range";

export type DocumentLineFieldErrors = Partial<
  Record<DocumentLineField, DocumentLineErrorCode>
>;

export type DocumentLineValidation =
  | {
      valid: true;
      fieldErrors: Record<string, never>;
    }
  | {
      valid: false;
      fieldErrors: DocumentLineFieldErrors;
    };

export interface ClientFiscalDetails {
  taxId?: string | null;
  address?: string | null;
}

export interface IssueValidationInput {
  /** Invoices need the client's tax id and address; proformas do not. */
  documentType?: "invoice" | "proforma";
  company: CompanyFiscalDetails;
  clientId?: string | null;
  /** Fiscal data of the selected client, when one is selected. */
  client?: ClientFiscalDetails | null;
  lines: readonly DocumentLineInput[];
}

export type IssueValidationErrorCode =
  | "issuer_legal_name_required"
  | "issuer_tax_id_required"
  | "issuer_address_required"
  | "client_required"
  | "client_tax_id_required"
  | "client_address_required"
  | "lines_required"
  | DocumentLineErrorCode;

export interface IssueValidationError {
  code: IssueValidationErrorCode;
  field: string;
}

export interface IssueValidation {
  valid: boolean;
  errors: IssueValidationError[];
}

const REQUIRED_COMPANY_FIELDS: readonly CompanyReadinessField[] = [
  "legalName",
  "taxId",
  "address",
];

const ISSUE_ERROR_BY_COMPANY_FIELD: Readonly<
  Record<
    CompanyReadinessField,
    {
      code: IssueValidationErrorCode;
      field: string;
    }
  >
> = {
  legalName: {
    code: "issuer_legal_name_required",
    field: "company.legalName",
  },
  taxId: {
    code: "issuer_tax_id_required",
    field: "company.taxId",
  },
  address: {
    code: "issuer_address_required",
    field: "company.address",
  },
};

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function getCompanyReadiness(
  company: CompanyFiscalDetails,
): CompanyReadiness {
  const missingFields = REQUIRED_COMPANY_FIELDS.filter(
    (field) => !hasText(company[field]),
  );

  return {
    ready: missingFields.length === 0,
    missingFields,
  };
}

export function validateDocumentLine(
  line: DocumentLineInput,
): DocumentLineValidation {
  const fieldErrors: DocumentLineFieldErrors = {};

  if (!hasText(line.description)) {
    fieldErrors.description = "description_required";
  }
  if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
    fieldErrors.quantity = "quantity_must_be_positive";
  }
  if (!Number.isSafeInteger(line.unitPriceCents) || line.unitPriceCents < 0) {
    fieldErrors.unitPriceCents =
      "unit_price_cents_must_be_non_negative_integer";
  }
  if (
    !Number.isFinite(line.taxRate) ||
    line.taxRate < 0 ||
    line.taxRate >= 100
  ) {
    fieldErrors.taxRate = "tax_rate_out_of_range";
  }
  if (
    !Number.isFinite(line.discountPct) ||
    line.discountPct < 0 ||
    line.discountPct > 100
  ) {
    fieldErrors.discountPct = "discount_pct_out_of_range";
  }

  if (Object.keys(fieldErrors).length === 0) {
    return { valid: true, fieldErrors: {} };
  }

  return { valid: false, fieldErrors };
}

export function validateIssue(input: IssueValidationInput): IssueValidation {
  const errors: IssueValidationError[] = [];
  const readiness = getCompanyReadiness(input.company);

  for (const field of readiness.missingFields) {
    errors.push(ISSUE_ERROR_BY_COMPANY_FIELD[field]);
  }

  if (!hasText(input.clientId)) {
    errors.push({ code: "client_required", field: "clientId" });
  } else if (input.documentType === "invoice" && input.client) {
    // A full Spanish invoice identifies the recipient by tax id and address
    // (spec FR-005); proformas carry no fiscal validity and do not need them.
    if (!hasText(input.client.taxId)) {
      errors.push({ code: "client_tax_id_required", field: "client.taxId" });
    }
    if (!hasText(input.client.address)) {
      errors.push({ code: "client_address_required", field: "client.address" });
    }
  }

  if (input.lines.length === 0) {
    errors.push({ code: "lines_required", field: "lines" });
  } else {
    input.lines.forEach((line, lineIndex) => {
      const validation = validateDocumentLine(line);

      for (const [field, code] of Object.entries(validation.fieldErrors)) {
        if (code) {
          errors.push({
            code,
            field: `lines.${lineIndex}.${field}`,
          });
        }
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function getDocumentTransition(
  currentStatus: DocumentStatus,
  action: DocumentLifecycleAction,
): DocumentTransition {
  if (currentStatus === "voided") {
    return {
      allowed: false,
      code: "voided_document_is_terminal",
      currentStatus,
    };
  }

  if (action === "issue") {
    return currentStatus === "draft"
      ? { allowed: true, nextStatus: "issued" }
      : {
          allowed: false,
          code: "document_not_draft",
          currentStatus,
        };
  }

  return currentStatus === "issued"
    ? { allowed: true, nextStatus: "voided" }
    : {
        allowed: false,
        code: "document_not_issued",
        currentStatus,
      };
}

export function buildIssuerSnapshot(
  issuer: IssuerSnapshotInput,
): IssuerSnapshot {
  return Object.freeze({
    legalName: issuer.legalName,
    taxId: issuer.taxId,
    address: issuer.address,
    email: issuer.email,
    phone: issuer.phone,
    logoKey: issuer.logoKey,
  });
}

export function buildClientSnapshot(
  client: ClientSnapshotInput,
): ClientSnapshot {
  return Object.freeze({
    name: client.name,
    taxId: client.taxId,
    address: client.address,
    email: client.email,
    phone: client.phone,
  });
}

export interface EditorClient {
  id: string;
  name: string;
  tax_id: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

export interface ClientPage {
  items: EditorClient[];
  next_cursor: string | null;
}

import type { CompanyPlanData } from "@/components/plan/types";

export interface EditorCompany extends Pick<CompanyPlanData, "plan" | "usage"> {
  default_due_days: number;
  default_tax_rate: string;
  retention_rate: string;
  currency: string;
  is_ready_to_issue: boolean;
}

export interface EditorLine {
  localId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  /** Frozen tax name (IVA, IGIC, IGI…). */
  taxName: string;
  taxRateId: string | null;
  unit: string;
  catalogItemId: string | null;
  discountPercentage: string;
}

export interface EditorTaxRate {
  id: string;
  name: string;
  rate: string;
  is_default: boolean;
}

export interface EditorSeries {
  id: string;
  doc_type: string;
  prefix: string;
  is_default: boolean;
  archived_at: string | null;
}

export interface EditorCollectionMethod {
  id: string;
  kind: "bank_account" | "bizum" | "paypal" | "cash" | "other";
  label: string;
  is_default: boolean;
}

export interface UnitsData {
  predefined: string[];
  custom: Array<{ id: string; name: string }>;
}

export interface CreatedDraft {
  id: string;
  status: "draft";
  series_created?: { prefix: string; renamed: boolean } | null;
}

/** `GET /api/v1/documents/:id` fields the editor needs to reopen a draft. */
export interface EditableDraft {
  id: string;
  doc_type: "invoice" | "proforma" | "receipt" | "quote" | "delivery_note";
  status: "draft" | "issued" | "voided";
  client_id: string | null;
  client_display: { name: string; tax_id: string | null } | null;
  series_id: string | null;
  collection_method_id: string | null;
  issue_date: string;
  due_date: string | null;
  valid_until: string | null;
  notes: string | null;
  lines: Array<{
    id: string;
    description: string;
    quantity: string;
    unit_price_cents: number;
    tax_rate: string;
    tax_name: string;
    tax_rate_id: string | null;
    unit: string | null;
    catalog_item_id: string | null;
    discount_pct: string;
  }>;
}

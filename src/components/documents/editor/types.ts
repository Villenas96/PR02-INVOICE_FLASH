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
  discountPercentage: string;
}

export interface CreatedDraft {
  id: string;
  status: "draft";
}

/** `GET /api/v1/documents/:id` fields the editor needs to reopen a draft. */
export interface EditableDraft {
  id: string;
  doc_type: "invoice" | "proforma" | "receipt";
  status: "draft" | "issued" | "voided";
  client_id: string | null;
  client_display: { name: string; tax_id: string | null } | null;
  issue_date: string;
  due_date: string | null;
  notes: string | null;
  lines: Array<{
    id: string;
    description: string;
    quantity: string;
    unit_price_cents: number;
    tax_rate: string;
    discount_pct: string;
  }>;
}

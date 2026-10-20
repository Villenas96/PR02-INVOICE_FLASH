import type { CompanyPlanData } from "@/components/plan/types";

export type DocumentType = "invoice" | "proforma" | "receipt";

export interface CompanySettings extends CompanyPlanData {
  id: string;
  legal_name: string | null;
  tax_id: string | null;
  address: string | null;
  email: string;
  phone: string | null;
  logo_key: string | null;
  default_due_days: number;
  default_tax_rate: string;
  retention_rate: string;
  currency: string;
  is_ready_to_issue: boolean;
  missing_fields: string[];
  missing_to_issue: string[];
}

export interface DocumentSeries {
  id: string;
  doc_type: DocumentType;
  prefix: string;
  next_number: number;
  is_default: boolean;
}

export interface SeriesPage {
  items: DocumentSeries[];
  next_cursor: string | null;
}

export type DocumentType = "invoice" | "proforma" | "receipt";

export interface CompanySettings {
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
  plan: "free" | "pro";
  is_ready_to_issue: boolean;
  missing_fields: string[];
  docs_issued_this_month: number;
  doc_limit: number;
  can_generate_pdf: boolean;
  can_send_email: boolean;
  can_share_link: boolean;
  usage_warning: boolean;
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

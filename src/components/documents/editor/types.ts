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

export interface EditorCompany {
  default_due_days: number;
  default_tax_rate: string;
  retention_rate: string;
  currency: string;
  is_ready_to_issue: boolean;
  plan: "free" | "pro";
  docs_issued_this_month: number;
  doc_limit: number;
  usage_warning: boolean;
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

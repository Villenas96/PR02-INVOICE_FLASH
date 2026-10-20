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

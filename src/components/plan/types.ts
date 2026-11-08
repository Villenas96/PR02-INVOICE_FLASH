import type { DocumentType, Feature, Plan, UiMode } from "@/lib/plan";

/** Per-type quota usage as returned by `GET /api/v1/company`. */
export interface TypeUsageData {
  document_type: DocumentType;
  used: number;
  limit: number;
  warning: boolean;
  reached: boolean;
}

/** Plan-related fields of `GET /api/v1/company`. */
export interface CompanyPlanData {
  role: "owner" | "advisor";
  plan: Plan;
  plan_label: string;
  usage: TypeUsageData[];
  features: Feature[];
  ui_mode: UiMode | null;
  effective_ui: UiMode;
  used_document_types: DocumentType[];
}

export function usageForType(
  company: Pick<CompanyPlanData, "usage">,
  documentType: DocumentType,
): TypeUsageData {
  return (
    company.usage.find((entry) => entry.document_type === documentType) ?? {
      document_type: documentType,
      used: 0,
      limit: 0,
      warning: false,
      reached: false,
    }
  );
}

export function companyHasFeature(
  company: Pick<CompanyPlanData, "features">,
  feature: Feature,
): boolean {
  return company.features.includes(feature);
}

import { ApiError } from "@/lib/api/errors";
import {
  type Feature,
  hasFeature,
  type Plan,
  planLabel,
  requiredPlanFor,
} from "@/lib/plan";

const FEATURE_NAMES: Record<Feature, string> = {
  email: "El envío de documentos por email",
  period_export: "La exportación del periodo para la gestoría",
  advanced_export: "La exportación avanzada",
  document_xlsx: "La descarga en hoja de cálculo",
  advisor_schedule: "El envío automático a la asesoría",
  advisor_access: "El acceso de la gestoría",
  catalog_import: "La importación de productos",
  recurring: "Las facturas recurrentes",
  reminders: "Los recordatorios de pago",
  bank_reconciliation: "La conciliación bancaria",
  dashboard_full: "El panel completo",
  ai_assistant: "La conexión con asistentes de IA",
  full_ui: "La interfaz completa",
};

export function featureNotInPlanError(feature: Feature): ApiError {
  const requiredPlan = requiredPlanFor(feature);
  return new ApiError(
    "feature_not_in_plan",
    403,
    `${FEATURE_NAMES[feature]} está disponible en el plan ${planLabel(requiredPlan)}.`,
    undefined,
    { feature, required_plan: requiredPlan, upgrade_url: "/billing" },
  );
}

/**
 * Server-side feature gate (FR-013). Hiding a control in the UI is never
 * enough: every route, job and MCP tool for a gated feature calls this.
 */
export function requireFeature(
  context: { plan: Plan },
  feature: Feature,
): void {
  if (!hasFeature(context.plan, feature)) {
    throw featureNotInPlanError(feature);
  }
}

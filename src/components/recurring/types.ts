export interface RecurringTemplate {
  id: string;
  client_id: string;
  series_id: string | null;
  collection_method_id: string | null;
  lines: Array<{
    description: string;
    quantity: string;
    unit_price_cents: number;
    tax_rate: string;
    tax_name?: string;
  }>;
  notes: string | null;
  due_days: number;
  frequency: Frequency;
  interval_count: number | null;
  interval_unit: "day" | "week" | "month" | null;
  start_on: string;
  end_on: string | null;
  max_cycles: number | null;
  action: "draft" | "issue" | "issue_and_send";
  status: "active" | "paused" | "finished";
  next_run_on: string | null;
  version: number;
}

export type Frequency =
  | "weekly"
  | "monthly"
  | "quarterly"
  | "semiannual"
  | "annual"
  | "custom";

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: "Cada semana",
  monthly: "Cada mes",
  quarterly: "Cada trimestre",
  semiannual: "Cada semestre",
  annual: "Cada año",
  custom: "Personalizada",
};

export const ACTION_LABELS: Record<RecurringTemplate["action"], string> = {
  draft: "Crear borrador",
  issue: "Emitir",
  issue_and_send: "Emitir y enviar por email",
};

export const STATUS_LABELS: Record<RecurringTemplate["status"], string> = {
  active: "Activa",
  paused: "En pausa",
  finished: "Finalizada",
};

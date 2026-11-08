export interface ExportItem {
  id: string;
  kind: "period_excel" | "advanced";
  status: "queued" | "running" | "ready" | "empty" | "failed";
  period_label: string | null;
  filters: { from: string; to: string; types: string[] };
  formats: string[];
  send_to_advisor: boolean;
  requested_by: "user" | "advisor" | "system";
  download_url: string | null;
  files: Array<{ filename: string; url: string }>;
  expires_at: string | null;
  created_at: string;
}

export const EXPORT_STATUS_LABELS: Record<ExportItem["status"], string> = {
  queued: "En cola",
  running: "Preparando…",
  ready: "Lista",
  empty: "Sin documentos",
  failed: "Error",
};

import type { ExportView } from "@/services/exports";

export function exportResponse(view: ExportView) {
  return {
    id: view.id,
    kind: view.kind,
    status: view.status,
    period_label: view.periodLabel,
    filters: view.filters,
    formats: view.formats,
    send_to_advisor: view.sendToAdvisor,
    requested_by: view.requestedBy.split(":")[0],
    download_url: view.files[0]?.url ?? null,
    files: view.files,
    expires_at: view.expiresAt,
    created_at: view.createdAt,
  };
}

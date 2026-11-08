import type { recurringTemplates } from "@/db/schema/recurring-template";

export function templateResponse(row: typeof recurringTemplates.$inferSelect) {
  return {
    id: row.id,
    client_id: row.clientId,
    series_id: row.seriesId,
    collection_method_id: row.collectionMethodId,
    lines: row.lines,
    notes: row.notes,
    due_days: row.dueDays,
    frequency: row.frequency,
    interval_count: row.intervalCount,
    interval_unit: row.intervalUnit,
    start_on: row.startOn,
    end_on: row.endOn,
    max_cycles: row.maxCycles,
    action: row.action,
    status: row.status,
    next_run_on: row.nextRunOn,
    version: row.version,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

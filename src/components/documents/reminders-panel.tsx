"use client";

import { useEffect, useState } from "react";

import { useReadOnly } from "@/components/access/read-only";
import { useMutation } from "@/components/ui/async-action";
import { apiRequest, jsonRequest } from "@/lib/api/client";

interface ReminderRow {
  id: string;
  sequence: number;
  scheduled_on: string;
  outcome: "queued" | "sent" | "skipped_paid" | "skipped_no_email" | "failed";
}

const OUTCOME_LABELS: Record<ReminderRow["outcome"], string> = {
  queued: "En cola",
  sent: "Enviado",
  skipped_paid: "No enviado (ya no hacía falta)",
  skipped_no_email: "No enviado (el cliente no tiene email)",
  failed: "Falló el envío",
};

const WARNING_TEXT: Record<string, string> = {
  client_without_email:
    "El cliente no tiene email: no podremos enviarle recordatorios de esta factura.",
  client_opted_out: "Los recordatorios están desactivados para este cliente.",
  document_opted_out: "",
};

function formattedDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

/**
 * Reminder state of an issued invoice (FR-041, FR-042): why it will not be
 * reminded, the per-invoice opt-out and what has been sent.
 */
export function RemindersPanel({
  documentId,
  initialEnabled,
  warning,
  onChanged,
}: {
  documentId: string;
  initialEnabled: boolean;
  warning: string | null;
  onChanged: () => void;
}) {
  const readOnly = useReadOnly();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [rows, setRows] = useState<ReminderRow[]>([]);
  const toggle = useMutation<unknown>({ refresh: false });

  useEffect(() => {
    apiRequest<{ items: ReminderRow[] }>(
      `/api/v1/documents/${documentId}/reminders`,
    )
      .then((page) => setRows(page.items))
      .catch(() => setRows([]));
  }, [documentId]);

  async function change(next: boolean) {
    setEnabled(next);
    const done = await toggle.run(() =>
      apiRequest(
        `/api/v1/documents/${documentId}`,
        jsonRequest("PATCH", { reminders_enabled: next }),
      ),
    );
    if (done === undefined) {
      setEnabled(!next);
      return;
    }
    onChanged();
  }

  const warningText = warning ? WARNING_TEXT[warning] : "";
  return (
    <section
      aria-labelledby="reminders-title"
      className="space-y-3 rounded-xl border bg-card p-5 shadow-sm"
    >
      <h2 id="reminders-title" className="font-semibold">
        Recordatorios de pago
      </h2>
      {warningText ? (
        <output className="block rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          {warningText}
        </output>
      ) : null}
      {readOnly ? null : (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            disabled={toggle.isLoading}
            onChange={(event) => change(event.target.checked)}
          />
          Enviar recordatorios de esta factura
        </label>
      )}
      {toggle.error ? (
        <p role="alert" className="text-sm text-destructive">
          {toggle.error}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no se ha enviado ningún recordatorio.
        </p>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.map((row) => (
            <li key={row.id}>
              {formattedDate(row.scheduled_on)} · recordatorio {row.sequence} ·{" "}
              {OUTCOME_LABELS[row.outcome]}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useMutation } from "@/components/ui/async-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiRequest, jsonRequest } from "@/lib/api/client";

import { RecurringForm } from "./recurring-form";
import {
  ACTION_LABELS,
  FREQUENCY_LABELS,
  type RecurringTemplate,
  STATUS_LABELS,
} from "./types";

interface Cycle {
  id: string;
  cycle_index: number;
  scheduled_on: string;
  template_version: number;
  outcome: string;
  reason_code: string | null;
  document_id: string | null;
  document_number: string | null;
}

const OUTCOME_LABELS: Record<string, string> = {
  pending: "En curso",
  draft_created: "Borrador creado",
  issued: "Emitida",
  sent: "Emitida y enviada",
  skipped_plan: "Omitido",
  failed: "No se pudo emitir (queda como borrador)",
};

const REASON_LABELS: Record<string, string> = {
  paused: "en pausa",
  plan: "tu plan no incluye recurrencias",
  client_archived: "el cliente está archivado",
  plan_limit_reached: "has alcanzado el límite mensual",
  company_incomplete: "faltan datos fiscales",
};

function formattedDate(date: string | null): string {
  if (!date) {
    return "—";
  }
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

export function RecurringDetail({
  templateId,
  clientName,
}: {
  templateId: string;
  clientName: string | null;
}) {
  const [template, setTemplate] = useState<RecurringTemplate | null>(null);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [editing, setEditing] = useState(false);
  const status = useMutation<RecurringTemplate>();

  const load = useCallback(async () => {
    const [loaded, page] = await Promise.all([
      apiRequest<RecurringTemplate>(
        `/api/v1/recurring-templates/${templateId}`,
      ),
      apiRequest<{ items: Cycle[] }>(
        `/api/v1/recurring-templates/${templateId}/cycles?limit=50`,
      ),
    ]);
    setTemplate(loaded);
    setCycles(page.items);
  }, [templateId]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  async function changeStatus(next: RecurringTemplate["status"]) {
    const updated = await status.run(() =>
      apiRequest<RecurringTemplate>(
        `/api/v1/recurring-templates/${templateId}`,
        jsonRequest("PATCH", { status: next }),
      ),
    );
    if (updated) {
      await load();
    }
  }

  if (!template) {
    return (
      <output className="block h-32 animate-pulse rounded-xl border bg-muted/50">
        <span className="sr-only">Cargando recurrencia…</span>
      </output>
    );
  }
  if (editing) {
    return (
      <RecurringForm
        template={template}
        onSaved={() => {
          setEditing(false);
          void load();
        }}
        initialClient={
          clientName
            ? { id: template.client_id, name: clientName, tax_id: null }
            : null
        }
      />
    );
  }
  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <Badge
              variant={template.status === "active" ? "default" : "outline"}
            >
              {STATUS_LABELS[template.status]}
            </Badge>
            <p className="text-sm text-muted-foreground">
              {FREQUENCY_LABELS[template.frequency]} ·{" "}
              {ACTION_LABELS[template.action]}
            </p>
            <p className="text-sm">
              Próximo ciclo:{" "}
              <strong>{formattedDate(template.next_run_on)}</strong>
              {clientName ? <> · Cliente: {clientName}</> : null}
            </p>
          </div>
          {template.status !== "finished" ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditing(true)}
              >
                Editar
              </Button>
              {template.status === "active" ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={status.isLoading}
                  onClick={() => changeStatus("paused")}
                >
                  Pausar
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={status.isLoading}
                  onClick={() => changeStatus("active")}
                >
                  Reanudar
                </Button>
              )}
              <Button
                type="button"
                variant="destructive"
                disabled={status.isLoading}
                onClick={() => changeStatus("finished")}
              >
                Finalizar
              </Button>
            </div>
          ) : null}
        </div>
        {status.error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {status.error}
          </p>
        ) : null}
      </section>

      <section
        aria-labelledby="recurring-cycles-title"
        className="rounded-xl border bg-card p-5 shadow-sm sm:p-6"
      >
        <h2 id="recurring-cycles-title" className="mb-3 text-lg font-semibold">
          Documentos generados
        </h2>
        {cycles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Todavía no se ha generado ningún ciclo.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Resultado</TableHead>
                <TableHead>Documento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cycles.map((cycle) => (
                <TableRow key={cycle.id}>
                  <TableCell>{formattedDate(cycle.scheduled_on)}</TableCell>
                  <TableCell>
                    {OUTCOME_LABELS[cycle.outcome] ?? cycle.outcome}
                    {cycle.reason_code ? (
                      <span className="block text-xs text-muted-foreground">
                        {REASON_LABELS[cycle.reason_code] ?? cycle.reason_code}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {cycle.document_id ? (
                      <Link
                        className="underline underline-offset-4"
                        href={`/documents/${cycle.document_id}`}
                      >
                        {cycle.document_number ?? "Borrador"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

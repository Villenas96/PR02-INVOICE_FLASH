"use client";

import { useState } from "react";

import { useMutation } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxLoader } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, jsonRequest } from "@/lib/api/client";
import { DOCUMENT_TYPE_LABELS } from "@/lib/documents/labels";
import type { DocumentType } from "@/lib/plan";

import { ExportResult } from "./export-result";
import { useExportJob } from "./use-export-job";

interface ClientOption {
  id: string;
  name: string;
  tax_id: string | null;
}

const TYPES: DocumentType[] = [
  "invoice",
  "receipt",
  "proforma",
  "quote",
  "delivery_note",
];
const STATUSES = [
  ["", "Todos"],
  ["issued", "Emitidos"],
  ["voided", "Anulados"],
  ["pending", "Pendientes de cobro"],
  ["overdue", "Vencidos"],
  ["paid", "Pagados"],
] as const;

const loadClients: ComboboxLoader<ClientOption> = async (
  query,
  cursor,
  signal,
) => {
  const params = new URLSearchParams({ limit: "25" });
  if (query) {
    params.set("q", query);
  }
  if (cursor) {
    params.set("cursor", cursor);
  }
  const page = await apiRequest<{
    items: ClientOption[];
    next_cursor: string | null;
  }>(`/api/v1/clients?${params}`, { signal });
  return { items: page.items, nextCursor: page.next_cursor };
};

function monthStart(): string {
  const today = new Date();
  return new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

/** Pro (FR-033): filters, spreadsheet and/or ZIP of PDFs in the background. */
export function AdvancedExport() {
  const [types, setTypes] = useState<DocumentType[]>(["invoice"]);
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState("");
  const [client, setClient] = useState<ClientOption | null>(null);
  const [formats, setFormats] = useState<Array<"xlsx" | "pdf_zip">>(["xlsx"]);
  const action = useMutation<{ export_id: string }>();
  const { job, track, isWaiting } = useExportJob();

  function toggle<T>(list: T[], value: T, checked: boolean): T[] {
    return checked
      ? [...new Set([...list, value])]
      : list.filter((item) => item !== value);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await action.run(() =>
      apiRequest<{ export_id: string }>(
        "/api/v1/exports",
        jsonRequest("POST", {
          kind: "advanced",
          types,
          from,
          to,
          formats,
          ...(status ? { status } : {}),
          ...(client ? { client_id: client.id } : {}),
        }),
      ),
    );
    if (created) {
      track(created.export_id);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-labelledby="advanced-export-title"
      className="space-y-5 rounded-xl border bg-card p-5 shadow-sm sm:p-6"
    >
      <div className="space-y-1">
        <h2 id="advanced-export-title" className="text-lg font-semibold">
          Exportación avanzada
        </h2>
        <p className="text-sm text-muted-foreground">
          Elige qué documentos incluir. Las exportaciones grandes se preparan en
          segundo plano y te avisamos al terminar.
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Tipos de documento</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {TYPES.map((type) => (
            <label key={type} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={types.includes(type)}
                onChange={(event) =>
                  setTypes((current) =>
                    toggle(current, type, event.target.checked),
                  )
                }
              />
              {DOCUMENT_TYPE_LABELS[type].singular}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor="export-from">Desde</Label>
          <Input
            id="export-from"
            type="date"
            required
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="export-to">Hasta</Label>
          <Input
            id="export-to"
            type="date"
            required
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="export-status">Estado</Label>
          <select
            id="export-status"
            className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {STATUSES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label id="export-client-label">Cliente</Label>
          <Combobox<ClientOption>
            aria-labelledby="export-client-label"
            value={client}
            onChange={setClient}
            getKey={(item) => item.id}
            getLabel={(item) => item.name}
            getDescription={(item) => item.tax_id}
            loadOptions={loadClients}
            clearLabel="Todos los clientes"
            placeholder="Todos los clientes"
            searchPlaceholder="Buscar cliente"
          />
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Formato</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={formats.includes("xlsx")}
              onChange={(event) =>
                setFormats((current) =>
                  toggle(current, "xlsx", event.target.checked),
                )
              }
            />
            Hoja de cálculo (Excel)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={formats.includes("pdf_zip")}
              onChange={(event) =>
                setFormats((current) =>
                  toggle(current, "pdf_zip", event.target.checked),
                )
              }
            />
            PDF en un archivo ZIP
          </label>
        </div>
      </fieldset>

      {action.error ? (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      ) : null}
      <Button
        type="submit"
        disabled={
          action.isLoading ||
          isWaiting ||
          types.length === 0 ||
          formats.length === 0
        }
      >
        Exportar
      </Button>
      <ExportResult job={job} isWaiting={isWaiting} />
    </form>
  );
}

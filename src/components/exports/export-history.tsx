"use client";

import { useCallback, useEffect, useState } from "react";

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
import { apiRequest } from "@/lib/api/client";

import { EXPORT_STATUS_LABELS, type ExportItem } from "./types";

const dateFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Madrid",
});

const REQUESTER_LABELS: Record<ExportItem["requested_by"], string> = {
  user: "Tú",
  advisor: "Gestoría",
  system: "Programado",
};

function describeExport(item: ExportItem): string {
  if (item.period_label) {
    return `Excel · ${item.period_label}`;
  }
  return `${item.formats.map((format) => (format === "xlsx" ? "Excel" : "ZIP de PDF")).join(" + ")} · ${item.filters.from} → ${item.filters.to}`;
}

/** Exports and advisor sends (FR-032): what was sent, by whom and when. */
export function ExportHistory() {
  const [items, setItems] = useState<ExportItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (cursor?: string) => {
    try {
      const params = new URLSearchParams({ limit: "10" });
      if (cursor) {
        params.set("cursor", cursor);
      }
      const page = await apiRequest<{
        items: ExportItem[];
        next_cursor: string | null;
      }>(`/api/v1/exports?${params}`);
      setItems((current) =>
        cursor ? [...current, ...page.items] : page.items,
      );
      setNextCursor(page.next_cursor);
      setError(null);
    } catch {
      setError("No se ha podido cargar el historial.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section
      aria-labelledby="export-history-title"
      className="space-y-4 rounded-xl border bg-card p-5 shadow-sm sm:p-6"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="export-history-title" className="text-lg font-semibold">
          Historial
        </h2>
        <Button type="button" variant="ghost" size="sm" onClick={() => load()}>
          Actualizar
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no has exportado nada.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Contenido</TableHead>
              <TableHead>Origen</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Descarga</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  {dateFormatter.format(new Date(item.created_at))}
                </TableCell>
                <TableCell>
                  {describeExport(item)}
                  {item.send_to_advisor ? (
                    <span className="block text-xs text-muted-foreground">
                      Enviado a la asesoría
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>{REQUESTER_LABELS[item.requested_by]}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      item.status === "failed" ? "destructive" : "outline"
                    }
                  >
                    {EXPORT_STATUS_LABELS[item.status]}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {item.files.length > 0
                    ? item.files.map((file) => (
                        <a
                          key={file.url}
                          href={file.url}
                          className="block text-sm underline underline-offset-4"
                        >
                          {file.filename}
                        </a>
                      ))
                    : item.status === "ready"
                      ? "Caducado"
                      : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {nextCursor ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => load(nextCursor)}
        >
          Ver más
        </Button>
      ) : null}
    </section>
  );
}

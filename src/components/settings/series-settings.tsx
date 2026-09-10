"use client";

import { useState } from "react";

import { useAsyncAction } from "@/components/ui/async-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiRequest, jsonRequest } from "@/lib/api/client";
import type { DocumentSeries, DocumentType } from "./types";

const typeLabels: Record<DocumentType, string> = {
  invoice: "Factura",
  proforma: "Proforma",
  receipt: "Recibo",
};

interface SeriesSettingsProps {
  items: DocumentSeries[];
  nextCursor: string | null;
  onCreate: (series: DocumentSeries) => void;
  onUpdate: (series: DocumentSeries) => void;
  onLoadMore: () => Promise<void>;
  isLoadingMore: boolean;
}

function SeriesRowEditor({
  series,
  onUpdate,
}: {
  series: DocumentSeries;
  onUpdate: (series: DocumentSeries) => void;
}) {
  const [prefix, setPrefix] = useState(series.prefix);
  const [nextNumber, setNextNumber] = useState(String(series.next_number));
  const action = useAsyncAction<DocumentSeries>();

  async function update(body: Record<string, unknown>) {
    const updated = await action.run(() =>
      apiRequest<DocumentSeries>(
        `/api/v1/series/${series.id}`,
        jsonRequest("PATCH", body),
      ),
    );
    if (updated) {
      onUpdate(updated);
      setPrefix(updated.prefix);
      setNextNumber(String(updated.next_number));
    }
  }

  return (
    <TableRow>
      <TableCell>
        <span className="font-medium">{typeLabels[series.doc_type]}</span>
      </TableCell>
      <TableCell>
        <Label className="sr-only" htmlFor={`prefix-${series.id}`}>
          Prefijo
        </Label>
        <Input
          id={`prefix-${series.id}`}
          className="min-w-28"
          maxLength={50}
          value={prefix}
          onChange={(event) => setPrefix(event.target.value)}
        />
      </TableCell>
      <TableCell>
        <Label className="sr-only" htmlFor={`next-${series.id}`}>
          Siguiente número
        </Label>
        <Input
          id={`next-${series.id}`}
          className="w-28"
          type="number"
          inputMode="numeric"
          min={1}
          value={nextNumber}
          onChange={(event) => setNextNumber(event.target.value)}
        />
      </TableCell>
      <TableCell>
        {series.is_default ? (
          <Badge variant="secondary">Predeterminada</Badge>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={action.isLoading}
            onClick={() => update({ is_default: true })}
          >
            Usar por defecto
          </Button>
        )}
      </TableCell>
      <TableCell className="text-right">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={action.isLoading}
          onClick={() =>
            update({
              prefix: prefix.trim(),
              next_number: Number(nextNumber),
            })
          }
        >
          {action.isLoading ? "Guardando…" : "Guardar"}
        </Button>
        {action.error ? (
          <p
            role="alert"
            className="mt-2 max-w-64 whitespace-normal text-xs text-destructive"
          >
            {action.error}
          </p>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

function NewSeriesForm({
  onCreate,
}: {
  onCreate: (series: DocumentSeries) => void;
}) {
  const [documentType, setDocumentType] = useState<DocumentType>("invoice");
  const [prefix, setPrefix] = useState(
    `${new Date().getFullYear().toString()}-`,
  );
  const [nextNumber, setNextNumber] = useState("1");
  const [isDefault, setIsDefault] = useState(false);
  const action = useAsyncAction<DocumentSeries>();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await action.run(() =>
      apiRequest<DocumentSeries>(
        "/api/v1/series",
        jsonRequest("POST", {
          doc_type: documentType,
          prefix: prefix.trim(),
          next_number: Number(nextNumber),
          is_default: isDefault,
        }),
      ),
    );
    if (created) {
      onCreate(created);
      setPrefix(`${new Date().getFullYear().toString()}-`);
      setNextNumber("1");
      setIsDefault(false);
    }
  }

  return (
    <form
      className="grid gap-4 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_10rem_auto]"
      onSubmit={handleSubmit}
    >
      <div className="space-y-2">
        <Label htmlFor="new-series-type">Tipo</Label>
        <select
          id="new-series-type"
          className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          value={documentType}
          onChange={(event) =>
            setDocumentType(event.target.value as DocumentType)
          }
        >
          <option value="invoice">Factura</option>
          <option value="proforma">Proforma</option>
          <option value="receipt">Recibo</option>
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="new-series-prefix">Prefijo</Label>
        <Input
          id="new-series-prefix"
          maxLength={50}
          required
          value={prefix}
          onChange={(event) => setPrefix(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="new-series-number">Número inicial</Label>
        <Input
          id="new-series-number"
          type="number"
          inputMode="numeric"
          min={1}
          required
          value={nextNumber}
          onChange={(event) => setNextNumber(event.target.value)}
        />
      </div>
      <div className="flex flex-col justify-end gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(event) => setIsDefault(event.target.checked)}
          />
          Predeterminada
        </label>
        <Button type="submit" disabled={action.isLoading}>
          {action.isLoading ? "Creando…" : "Crear serie"}
        </Button>
      </div>
      {action.error ? (
        <p
          role="alert"
          className="text-sm text-destructive sm:col-span-2 lg:col-span-4"
        >
          {action.error}
        </p>
      ) : null}
    </form>
  );
}

export function SeriesSettings({
  items,
  nextCursor,
  onCreate,
  onUpdate,
  onLoadMore,
  isLoadingMore,
}: SeriesSettingsProps) {
  return (
    <section
      className="rounded-xl border bg-card p-5 shadow-sm sm:p-6"
      aria-labelledby="series-title"
    >
      <div className="mb-6 space-y-1">
        <h2 id="series-title" className="text-lg font-semibold">
          Series de numeración
        </h2>
        <p className="text-sm text-muted-foreground">
          El número se reserva únicamente al emitir. Una serie utilizada ya no
          puede cambiar de prefijo ni de siguiente número.
        </p>
      </div>

      <div className="space-y-6">
        <NewSeriesForm onCreate={onCreate} />

        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No hay series configuradas.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Prefijo</TableHead>
                <TableHead>Siguiente</TableHead>
                <TableHead>Uso</TableHead>
                <TableHead className="text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((series) => (
                <SeriesRowEditor
                  key={series.id}
                  series={series}
                  onUpdate={onUpdate}
                />
              ))}
            </TableBody>
          </Table>
        )}

        {nextCursor ? (
          <Button
            type="button"
            variant="outline"
            disabled={isLoadingMore}
            onClick={onLoadMore}
          >
            {isLoadingMore ? "Cargando…" : "Cargar más series"}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

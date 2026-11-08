"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useMutation } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiRequest, jsonRequest } from "@/lib/api/client";
import {
  CATALOG_FIELD_LABELS,
  CATALOG_IMPORT_FIELDS,
  type CatalogMapping,
  missingRequiredFields,
} from "@/lib/csv/map-columns";
import {
  type CatalogRowError,
  validateCatalogRow,
} from "@/lib/csv/validate-catalog-row";
import { createCents, formatEur } from "@/lib/money";

const POLL_INTERVAL_MS = 1_000;
const PREVIEW_ROWS = 10;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

type ImportStatus =
  | "uploaded"
  | "analyzing"
  | "preview_ready"
  | "applying"
  | "done"
  | "failed"
  | "rejected";

interface ImportView {
  id: string;
  status: ImportStatus;
  error_code: string | null;
  preview: {
    headers: string[];
    suggested_mapping: CatalogMapping;
    missing_fields: string[];
    summary: {
      rows: number;
      valid: number;
      errored: number;
      duplicates: number;
    };
    sample: string[][];
    errors: CatalogRowError[];
  } | null;
  result: {
    created: number;
    updated: number;
    skipped: number;
    errored: number;
    errors: CatalogRowError[];
  } | null;
}

const WAITING: readonly ImportStatus[] = ["uploaded", "analyzing", "applying"];

function rejectionMessage(code: string | null): string {
  if (code === "import_too_large") {
    return "El archivo supera 5 MB o 5.000 filas. Divídelo en varios archivos e impórtalos por separado.";
  }
  if (code === "csv_invalid") {
    return "No hemos podido leer el archivo como CSV. Guárdalo desde tu hoja de cálculo como «CSV UTF-8» o «CSV (delimitado por comas)».";
  }
  return "No hemos podido procesar el archivo. Inténtalo de nuevo.";
}

function useImport(importId: string | null) {
  const [view, setView] = useState<ImportView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!importId) {
      return;
    }
    try {
      setView(await apiRequest<ImportView>(`/api/v1/imports/${importId}`));
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se ha podido cargar la importación.",
      );
    }
  }, [importId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!view || !WAITING.includes(view.status)) {
      return;
    }
    const timer = setTimeout(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [view, refresh]);

  return { view, error, refresh };
}

function UploadStep({ onUploaded }: { onUploaded: (id: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useMutation<{ import_id: string }>();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) {
      return;
    }
    const result = await upload.run(() => {
      if (file.size > MAX_FILE_BYTES) {
        return Promise.reject(
          new Error("El archivo supera 5 MB. Divídelo en varios archivos."),
        );
      }
      const body = new FormData();
      body.set("kind", "catalog");
      body.set("file", file);
      return apiRequest<{ import_id: string }>("/api/v1/imports", {
        method: "POST",
        body,
      });
    });
    if (result) {
      onUploaded(result.import_id);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border bg-card p-5 shadow-sm sm:p-6"
      aria-labelledby="import-upload-title"
    >
      <div className="space-y-1">
        <h2 id="import-upload-title" className="text-lg font-semibold">
          1. Sube tu archivo
        </h2>
        <p className="text-sm text-muted-foreground">
          CSV de hasta 5 MB y 5.000 filas, con una fila de cabecera. Antes de
          crear nada verás una vista previa.{" "}
          <a
            className="font-medium underline underline-offset-4"
            href="/api/v1/imports/templates/catalog.csv"
            download
          >
            Descargar plantilla
          </a>
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="catalog-import-file">Archivo CSV</Label>
        <Input
          ref={inputRef}
          id="catalog-import-file"
          type="file"
          accept=".csv,text/csv"
          required
          disabled={upload.isLoading}
        />
      </div>
      {upload.error ? (
        <p role="alert" className="text-sm text-destructive">
          {upload.error}
        </p>
      ) : null}
      <Button type="submit" disabled={upload.isLoading}>
        {upload.isLoading ? "Subiendo…" : "Analizar archivo"}
      </Button>
    </form>
  );
}

function ColumnSelect({
  field,
  headers,
  mapping,
  onChange,
}: {
  field: (typeof CATALOG_IMPORT_FIELDS)[number];
  headers: string[];
  mapping: CatalogMapping;
  onChange: (mapping: CatalogMapping) => void;
}) {
  const id = `mapping-${field}`;
  const required = field === "description" || field === "unit_price";
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {CATALOG_FIELD_LABELS[field]}
        {required ? "" : " (opcional)"}
      </Label>
      <select
        id={id}
        className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        value={mapping[field] ?? ""}
        onChange={(event) =>
          onChange({
            ...mapping,
            [field]:
              event.target.value === "" ? null : Number(event.target.value),
          })
        }
      >
        <option value="">No importar</option>
        {headers.map((header, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the column position is the option's identity; headers never reorder.
          <option key={index} value={index}>
            {header || `Columna ${index + 1}`}
          </option>
        ))}
      </select>
    </div>
  );
}

function PreviewStep({
  view,
  onConfirmed,
}: {
  view: ImportView;
  onConfirmed: () => void;
}) {
  const preview = view.preview;
  const [mapping, setMapping] = useState<CatalogMapping>(
    preview?.suggested_mapping ?? {
      description: null,
      unit_price: null,
      tax_rate: null,
      unit: null,
    },
  );
  const [policy, setPolicy] = useState<"skip" | "update">("skip");
  const confirm = useMutation<{ import_id: string }>();

  const missing = missingRequiredFields(mapping);
  const indexes = Object.values(mapping).filter(
    (index): index is number => index !== null,
  );
  const repeated = new Set(indexes).size !== indexes.length;
  const sameAsSuggested =
    JSON.stringify(mapping) === JSON.stringify(preview?.suggested_mapping);

  const rows = useMemo(
    () =>
      (preview?.sample ?? []).slice(0, PREVIEW_ROWS).map((cells, index) => ({
        line: index + 2,
        result:
          missing.length === 0
            ? validateCatalogRow(cells, mapping, index + 2)
            : null,
      })),
    [preview, mapping, missing.length],
  );

  if (!preview) {
    return null;
  }

  async function handleConfirm() {
    const result = await confirm.run(() =>
      apiRequest<{ import_id: string }>(
        `/api/v1/imports/${view.id}/confirm`,
        jsonRequest("POST", { mapping, duplicate_policy: policy }),
      ),
    );
    if (result) {
      onConfirmed();
    }
  }

  return (
    <section
      className="space-y-6 rounded-xl border bg-card p-5 shadow-sm sm:p-6"
      aria-labelledby="import-preview-title"
    >
      <div className="space-y-1">
        <h2 id="import-preview-title" className="text-lg font-semibold">
          2. Revisa las columnas y la vista previa
        </h2>
        <p className="text-sm text-muted-foreground">
          {preview.summary.rows.toLocaleString("es-ES")} filas en el archivo
          {sameAsSuggested && missing.length === 0
            ? ` · ${preview.summary.valid.toLocaleString("es-ES")} válidas · ${preview.summary.errored.toLocaleString("es-ES")} con errores · ${preview.summary.duplicates.toLocaleString("es-ES")} ya existen`
            : ""}
          . Todavía no se ha creado ningún producto.
        </p>
      </div>

      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="sr-only">Correspondencia de columnas</legend>
        {CATALOG_IMPORT_FIELDS.map((field) => (
          <ColumnSelect
            key={field}
            field={field}
            headers={preview.headers}
            mapping={mapping}
            onChange={setMapping}
          />
        ))}
      </fieldset>
      {missing.length > 0 ? (
        <p role="alert" className="text-sm text-destructive">
          Elige qué columna contiene{" "}
          {missing.map((field) => CATALOG_FIELD_LABELS[field]).join(" y ")}.
        </p>
      ) : repeated ? (
        <p role="alert" className="text-sm text-destructive">
          Cada columna solo puede usarse para un campo.
        </p>
      ) : null}

      {missing.length === 0 ? (
        <section
          aria-label="Vista previa de las primeras filas"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a horizontally scrollable region must be reachable by keyboard (WCAG 2.1.1).
          tabIndex={0}
          className="overflow-x-auto rounded-lg border focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <table className="w-full caption-bottom text-sm">
            <caption className="sr-only">
              Primeras filas con la correspondencia elegida
            </caption>
            <TableHeader>
              <TableRow>
                <TableHead>Fila</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead className="text-right">Impuesto</TableHead>
                <TableHead>Unidad</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ line, result }) =>
                result?.ok ? (
                  <TableRow key={line}>
                    <TableCell>{line}</TableCell>
                    <TableCell>{result.value.description}</TableCell>
                    <TableCell className="text-right">
                      {formatEur(createCents(result.value.unitPriceCents))}
                    </TableCell>
                    <TableCell className="text-right">
                      {result.value.taxRate
                        ? `${Number(result.value.taxRate).toLocaleString("es-ES")} %`
                        : "Por defecto"}
                    </TableCell>
                    <TableCell>{result.value.unit ?? "—"}</TableCell>
                    <TableCell>Correcta</TableCell>
                  </TableRow>
                ) : (
                  <TableRow key={line}>
                    <TableCell>{line}</TableCell>
                    <TableCell colSpan={4} className="text-destructive">
                      {result?.errors.map((error) => error.message).join(" ")}
                    </TableCell>
                    <TableCell className="text-destructive">
                      Con errores
                    </TableCell>
                  </TableRow>
                ),
              )}
            </TableBody>
          </table>
        </section>
      ) : null}

      {sameAsSuggested && preview.errors.length > 0 ? (
        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            Ver errores por fila ({preview.errors.length})
          </summary>
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {preview.errors.map((error) => (
              <li key={`${error.line}-${error.field}`}>
                Fila {error.line}: {error.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          Si un producto ya existe en tu catálogo
        </legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="duplicate-policy"
            value="skip"
            checked={policy === "skip"}
            onChange={() => setPolicy("skip")}
          />
          Dejarlo como está
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="duplicate-policy"
            value="update"
            checked={policy === "update"}
            onChange={() => setPolicy("update")}
          />
          Actualizar su precio, impuesto y unidad
        </label>
      </fieldset>

      {confirm.error ? (
        <p role="alert" className="text-sm text-destructive">
          {confirm.error}
        </p>
      ) : null}
      <Button
        type="button"
        disabled={confirm.isLoading || missing.length > 0 || repeated}
        onClick={handleConfirm}
      >
        {confirm.isLoading ? "Importando…" : "Importar productos"}
      </Button>
    </section>
  );
}

function SummaryStep({ view }: { view: ImportView }) {
  const result = view.result;
  if (!result) {
    return null;
  }
  return (
    <section
      className="space-y-4 rounded-xl border bg-card p-5 shadow-sm sm:p-6"
      aria-labelledby="import-summary-title"
    >
      <h2 id="import-summary-title" className="text-lg font-semibold">
        Importación completada
      </h2>
      <dl className="grid gap-3 sm:grid-cols-4">
        {[
          ["Creados", result.created],
          ["Actualizados", result.updated],
          ["Omitidos", result.skipped],
          ["Con errores", result.errored],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border p-3">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="text-2xl font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      {result.errors.length > 0 ? (
        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            Filas no importadas ({result.errors.length})
          </summary>
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {result.errors.map((error) => (
              <li key={`${error.line}-${error.field}`}>
                Fila {error.line}: {error.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <Button asChild>
        <Link href="/catalog">Ver catálogo</Link>
      </Button>
    </section>
  );
}

/** CSV catalog import (FR-031): upload, mapping and preview, summary. */
export function ImportWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const importId = searchParams.get("id");
  const { view, error, refresh } = useImport(importId);

  if (!importId) {
    return (
      <UploadStep
        onUploaded={(id) => router.replace(`/catalog/import?id=${id}`)}
      />
    );
  }
  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  }
  if (!view || WAITING.includes(view.status)) {
    return (
      <output
        className="block rounded-xl border bg-card p-6 text-sm"
        aria-live="polite"
      >
        {view?.status === "applying"
          ? "Importando productos…"
          : "Analizando el archivo…"}
      </output>
    );
  }
  if (view.status === "rejected" || view.status === "failed") {
    return (
      <div className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
        <p role="alert" className="text-sm text-destructive">
          {rejectionMessage(view.error_code)}
        </p>
        <Button asChild variant="outline">
          <Link href="/catalog/import">Subir otro archivo</Link>
        </Button>
      </div>
    );
  }
  if (view.status === "preview_ready") {
    return <PreviewStep view={view} onConfirmed={() => void refresh()} />;
  }
  return <SummaryStep view={view} />;
}

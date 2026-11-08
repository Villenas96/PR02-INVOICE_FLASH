"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useMutation } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, jsonRequest } from "@/lib/api/client";
import {
  BANK_FIELDS,
  type BankMapping,
  missingBankFields,
} from "@/lib/bank/csv-statement";
import { createCents, formatEur } from "@/lib/money";

interface BankAccount {
  id: string;
  label: string;
  iban: string | null;
}

interface ImportView {
  id: string;
  status: string;
  error_code: string | null;
  preview: {
    format: string;
    headers: string[];
    suggested_mapping: BankMapping | null;
    summary: {
      movements: number;
      credits: number;
      debits: number;
      new_movements: number;
      duplicates: number;
      errored: number;
    };
    closing_balance_cents: number | null;
    errors: Array<{ line: number; message: string }>;
    message?: string;
  } | null;
  result: { created: number; duplicates: number } | null;
}

const FIELD_LABELS: Record<(typeof BANK_FIELDS)[number], string> = {
  operation_date: "Fecha",
  value_date: "Fecha valor (opcional)",
  concept: "Concepto",
  amount: "Importe",
  balance: "Saldo (opcional)",
};

const ERROR_MESSAGES: Record<string, string> = {
  statement_invalid:
    "El fichero Norma 43 no es válido o está incompleto. Descárgalo de nuevo desde tu banco.",
  account_mismatch:
    "El extracto es de otra cuenta distinta a la elegida. Elige la cuenta correcta.",
  import_too_large: "El archivo supera 5 MB o 5.000 filas. Divídelo en varios.",
  csv_invalid: "No hemos podido leer el archivo. Prueba con Norma 43 o CSV.",
  file_missing: "No hemos encontrado el archivo subido. Súbelo de nuevo.",
};

const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** Bank statement import: upload, preview, confirm (FR-043). */
export function StatementImport({ onImported }: { onImported: () => void }) {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [methodId, setMethodId] = useState("");
  const [importId, setImportId] = useState<string | null>(null);
  const [view, setView] = useState<ImportView | null>(null);
  const [mapping, setMapping] = useState<BankMapping | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useMutation<{ import_id: string }>({ refresh: false });
  const confirm = useMutation<unknown>({ refresh: false });

  useEffect(() => {
    apiRequest<{
      items: Array<BankAccount & { kind: string; archived_at: string | null }>;
    }>("/api/v1/collection-methods?archived=false")
      .then((page) => {
        const banks = page.items.filter((item) => item.kind === "bank_account");
        setAccounts(banks);
        setMethodId(banks[0]?.id ?? "");
      })
      .catch(() => setAccounts([]));
  }, []);

  const refresh = useCallback(async () => {
    if (importId) {
      setView(await apiRequest<ImportView>(`/api/v1/imports/${importId}`));
    }
  }, [importId]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  const waiting =
    view !== null &&
    ["uploaded", "analyzing", "applying"].includes(view.status);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `view` re-arms the timer after every poll while still waiting.
  useEffect(() => {
    if (!waiting) {
      return;
    }
    const timer = setTimeout(
      () => void refresh().catch(() => undefined),
      1_000,
    );
    return () => clearTimeout(timer);
  }, [waiting, refresh, view]);

  useEffect(() => {
    if (view?.status === "preview_ready") {
      setMapping(
        (current) => current ?? view.preview?.suggested_mapping ?? null,
      );
    }
    if (view?.status === "done") {
      onImported();
    }
  }, [view, onImported]);

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file || !methodId) {
      return;
    }
    const created = await upload.run(() => {
      const body = new FormData();
      body.set("kind", "bank_statement");
      body.set("collection_method_id", methodId);
      body.set("file", file);
      return apiRequest<{ import_id: string }>("/api/v1/imports", {
        method: "POST",
        body,
      });
    });
    if (created) {
      setView(null);
      setMapping(null);
      setImportId(created.import_id);
    }
  }

  async function handleConfirm() {
    await confirm.run(() =>
      apiRequest(
        `/api/v1/imports/${importId}/confirm`,
        jsonRequest("POST", mapping ? { mapping } : {}),
      ),
    );
    await refresh();
  }

  const preview = view?.preview;
  const isCsv = preview?.format !== "norma43";
  const missing = mapping ? missingBankFields(mapping) : [];
  return (
    <section
      aria-labelledby="statement-title"
      className="space-y-4 rounded-xl border bg-card p-5 shadow-sm sm:p-6"
    >
      <div className="space-y-1">
        <h2 id="statement-title" className="text-lg font-semibold">
          Importar extracto bancario
        </h2>
        <p className="text-sm text-muted-foreground">
          Norma 43 o CSV de tu banco. Los movimientos que ya importaste no se
          duplican, aunque el extracto se solape.
        </p>
      </div>

      {accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Primero añade tu cuenta bancaria en Ajustes → Cobros e impuestos.
        </p>
      ) : (
        <form
          onSubmit={handleUpload}
          className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          <div className="space-y-2">
            <Label htmlFor="statement-account">Cuenta</Label>
            <select
              id="statement-account"
              className={SELECT_CLASS}
              value={methodId}
              onChange={(event) => setMethodId(event.target.value)}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="statement-file">Archivo</Label>
            <Input
              ref={inputRef}
              id="statement-file"
              type="file"
              accept=".n43,.txt,.csv,.xlsx,text/csv"
              required
            />
          </div>
          <Button type="submit" disabled={upload.isLoading || waiting}>
            Analizar
          </Button>
        </form>
      )}
      {upload.error ? (
        <p role="alert" className="text-sm text-destructive">
          {upload.error}
        </p>
      ) : null}

      {waiting ? (
        <output className="block text-sm" aria-live="polite">
          {view?.status === "applying"
            ? "Importando movimientos…"
            : "Analizando el extracto…"}
        </output>
      ) : null}

      {view && (view.status === "rejected" || view.status === "failed") ? (
        <p role="alert" className="text-sm text-destructive">
          {(view.error_code && ERROR_MESSAGES[view.error_code]) ??
            "No hemos podido procesar el extracto."}
          {view.preview?.message ? ` ${view.preview.message}` : ""}
        </p>
      ) : null}

      {view?.status === "preview_ready" && preview ? (
        <div className="space-y-4">
          <p className="text-sm">
            {preview.summary.movements} movimientos ({preview.summary.credits}{" "}
            ingresos y {preview.summary.debits} cargos):{" "}
            <strong>{preview.summary.new_movements} nuevos</strong> y{" "}
            {preview.summary.duplicates} ya importados.
            {preview.closing_balance_cents !== null
              ? ` Saldo final: ${formatEur(createCents(preview.closing_balance_cents))}.`
              : ""}
          </p>
          {isCsv && mapping ? (
            <fieldset className="grid gap-3 sm:grid-cols-3">
              <legend className="mb-1 text-sm font-medium">Columnas</legend>
              {BANK_FIELDS.map((field) => (
                <div key={field} className="space-y-1">
                  <Label htmlFor={`bank-${field}`}>{FIELD_LABELS[field]}</Label>
                  <select
                    id={`bank-${field}`}
                    className={SELECT_CLASS}
                    value={mapping[field] ?? ""}
                    onChange={(event) =>
                      setMapping({
                        ...mapping,
                        [field]:
                          event.target.value === ""
                            ? null
                            : Number(event.target.value),
                      })
                    }
                  >
                    <option value="">No importar</option>
                    {preview.headers.map((header, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: the column position is the option's identity.
                      <option key={index} value={index}>
                        {header || `Columna ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </fieldset>
          ) : null}
          {preview.errors.length > 0 ? (
            <details className="rounded-lg border p-3 text-sm">
              <summary className="cursor-pointer font-medium">
                Filas con errores ({preview.errors.length})
              </summary>
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                {preview.errors.map((error) => (
                  <li key={`${error.line}-${error.message}`}>
                    Fila {error.line}: {error.message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {confirm.error ? (
            <p role="alert" className="text-sm text-destructive">
              {confirm.error}
            </p>
          ) : null}
          <Button
            type="button"
            disabled={confirm.isLoading || (isCsv && missing.length > 0)}
            onClick={handleConfirm}
          >
            {confirm.isLoading ? "Importando…" : "Importar movimientos"}
          </Button>
        </div>
      ) : null}

      {view?.status === "done" && view.result ? (
        <output className="block text-sm" aria-live="polite">
          Importación completada: {view.result.created} movimientos nuevos y{" "}
          {view.result.duplicates} ya existentes.
        </output>
      ) : null}
    </section>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";

import { useMutation } from "@/components/ui/async-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest, jsonRequest } from "@/lib/api/client";
import { createCents, formatEur } from "@/lib/money";

import {
  CONFIDENCE_LABELS,
  formattedDate,
  REASON_LABELS,
  type Suggestion,
} from "./types";

function SuggestionRow({
  suggestion,
  onConfirmed,
}: {
  suggestion: Suggestion;
  onConfirmed: () => void;
}) {
  const action = useMutation<unknown>({ refresh: false });

  async function confirm() {
    const done = await action.run(() =>
      apiRequest("/api/v1/reconciliations", {
        ...jsonRequest("POST", {
          bank_transaction_id: suggestion.bank_transaction_id,
          allocations: [
            {
              document_id: suggestion.document_id,
              amount_cents: suggestion.allocation_cents,
            },
          ],
        }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
      }),
    );
    if (done !== undefined) {
      onConfirmed();
    }
  }

  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="truncate text-sm font-medium">
          {formattedDate(suggestion.transaction.operation_on)} ·{" "}
          {suggestion.transaction.concept}
        </p>
        <p className="text-sm text-muted-foreground">
          {formatEur(createCents(suggestion.transaction.amount_cents))} →
          factura <strong>{suggestion.invoice.full_number}</strong>
          {suggestion.invoice.client_name
            ? ` de ${suggestion.invoice.client_name}`
            : ""}{" "}
          (pendiente {formatEur(createCents(suggestion.invoice.pending_cents))})
        </p>
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge
            variant={suggestion.confidence === "high" ? "default" : "outline"}
          >
            {CONFIDENCE_LABELS[suggestion.confidence]}
          </Badge>
          {suggestion.reasons
            .map((reason) => REASON_LABELS[reason] ?? reason)
            .join(" · ")}
        </p>
      </div>
      <div className="flex flex-col items-start gap-1 sm:items-end">
        <Button
          type="button"
          size="sm"
          disabled={action.isLoading}
          onClick={confirm}
        >
          {action.isLoading
            ? "Registrando…"
            : `Registrar cobro de ${formatEur(createCents(suggestion.allocation_cents))}`}
        </Button>
        {action.error ? (
          <span role="alert" className="text-xs text-destructive">
            {action.error}
          </span>
        ) : null}
      </div>
    </li>
  );
}

/** Match suggestions for unmatched income, one click to register each (FR-044). */
export function SuggestionsPanel({
  refreshKey,
  onChanged,
}: {
  refreshKey: number;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const page = await apiRequest<{ items: Suggestion[] }>(
        "/api/v1/reconciliation/suggestions",
      );
      setItems(page.items);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the parent signals a change.
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <section
      aria-labelledby="suggestions-title"
      className="rounded-xl border bg-card p-5 shadow-sm sm:p-6"
    >
      <h2 id="suggestions-title" className="text-lg font-semibold">
        Sugerencias
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Ingresos del banco que parecen el cobro de una factura pendiente.
      </p>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          No se han podido cargar las sugerencias.
        </p>
      ) : !items ? (
        <p className="mt-3 text-sm text-muted-foreground">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No hay sugerencias. Importa un extracto o casa los movimientos a mano.
        </p>
      ) : (
        <ul className="mt-2 divide-y">
          {items.map((suggestion) => (
            <SuggestionRow
              key={`${suggestion.bank_transaction_id}-${suggestion.document_id}`}
              suggestion={suggestion}
              onConfirmed={() => {
                void load();
                onChanged();
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

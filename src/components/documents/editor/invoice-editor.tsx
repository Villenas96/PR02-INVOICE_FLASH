"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  ClientPicker,
  type SelectedClient,
} from "@/components/documents/editor/client-picker";
import {
  DocumentTypeSelector,
  type EditableDocumentType,
} from "@/components/documents/editor/document-type-selector";
import {
  createInitialEditorLine,
  InvoiceLines,
} from "@/components/documents/editor/invoice-lines";
import { usageForType } from "@/components/plan/types";
import { useMutation } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, jsonRequest } from "@/lib/api/client";
import { calculateBilling } from "@/lib/billing";
import { documentTypePlural } from "@/lib/documents/labels";
import { createCents, formatEur, parseEuroInput } from "@/lib/money";

import type {
  CreatedDraft,
  EditableDraft,
  EditorCompany,
  EditorLine,
} from "./types";

function madridToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function addCalendarDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function centsToEuroInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function decimalToInput(value: string): string {
  return String(Number(value));
}

function editorLinesFromDraft(draft: EditableDraft): EditorLine[] {
  if (draft.lines.length === 0) {
    return [createInitialEditorLine()];
  }
  return draft.lines.map((line) => ({
    localId: line.id,
    description: line.description,
    quantity: decimalToInput(line.quantity),
    unitPrice: centsToEuroInput(line.unit_price_cents),
    taxRate: line.tax_rate,
    discountPercentage: decimalToInput(line.discount_pct),
  }));
}

/**
 * Creates a new draft or, with `documentId`, edits an existing one. Saving a
 * new draft POSTs it; an existing draft is PATCHed in place.
 */
export function InvoiceEditor({ documentId }: { documentId?: string } = {}) {
  const router = useRouter();
  const [company, setCompany] = useState<EditorCompany>();
  const [documentType, setDocumentType] =
    useState<EditableDocumentType>("invoice");
  const [client, setClient] = useState<SelectedClient | null>(null);
  const [issueDate, setIssueDate] = useState(() => madridToday());
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<EditorLine[]>(() => [
    createInitialEditorLine(),
  ]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const saveAction = useMutation<CreatedDraft>();

  useEffect(() => {
    const controller = new AbortController();
    const companyRequest = apiRequest<EditorCompany>("/api/v1/company", {
      signal: controller.signal,
    });
    const draftRequest = documentId
      ? apiRequest<EditableDraft>(`/api/v1/documents/${documentId}`, {
          signal: controller.signal,
        })
      : Promise.resolve(undefined);
    Promise.all([companyRequest, draftRequest])
      .then(([companyResult, draft]) => {
        setCompany(companyResult);
        if (draft) {
          if (draft.status !== "draft") {
            setLoadError(
              "Solo puedes editar borradores. Los documentos emitidos no se modifican.",
            );
            setCompany(undefined);
            return;
          }
          if (draft.doc_type === "invoice" || draft.doc_type === "proforma") {
            setDocumentType(draft.doc_type);
          }
          setClient(
            draft.client_id && draft.client_display
              ? {
                  id: draft.client_id,
                  name: draft.client_display.name,
                  tax_id: draft.client_display.tax_id,
                }
              : null,
          );
          setIssueDate(draft.issue_date);
          setDueDate(draft.due_date ?? "");
          setNotes(draft.notes ?? "");
          setLines(editorLinesFromDraft(draft));
          return;
        }
        setDueDate(
          (current) =>
            current ||
            addCalendarDays(madridToday(), companyResult.default_due_days),
        );
        setLines((current) =>
          current.map((line) =>
            line.taxRate
              ? line
              : { ...line, taxRate: companyResult.default_tax_rate },
          ),
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setLoadError(
          error instanceof Error
            ? error.message
            : "No se ha podido preparar el editor.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [documentId]);

  const calculation = useMemo(() => {
    if (!company) {
      return undefined;
    }
    try {
      return calculateBilling({
        retentionRate: company.retention_rate,
        lines: lines.map((line) => ({
          quantity: line.quantity,
          unitPriceCents: parseEuroInput(line.unitPrice),
          taxRate: line.taxRate,
          discountPercentage: line.discountPercentage || "0",
        })),
      });
    } catch {
      return undefined;
    }
  }, [company, lines]);

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await saveAction.run(() =>
      apiRequest<CreatedDraft>(
        documentId ? `/api/v1/documents/${documentId}` : "/api/v1/documents",
        jsonRequest(documentId ? "PATCH" : "POST", {
          doc_type: documentType,
          client_id: client?.id ?? null,
          issue_date: issueDate,
          due_date: dueDate || null,
          notes: notes.trim() || null,
          lines: lines.map((line) => ({
            description: line.description.trim(),
            quantity: line.quantity,
            unit_price_cents: parseEuroInput(line.unitPrice),
            tax_rate: line.taxRate,
            discount_pct: line.discountPercentage || "0",
          })),
        }),
      ),
    );
    if (saved) {
      router.push(`/documents/${saved.id}`);
    }
  }

  if (isLoading) {
    return (
      <output className="block h-96 animate-pulse rounded-xl border bg-muted/50">
        <span className="sr-only">Preparando editor…</span>
      </output>
    );
  }

  if (!company) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6">
        <p
          role="alert"
          className="text-sm text-[color-mix(in_oklch,var(--destructive),var(--foreground)_35%)]"
        >
          {loadError ?? "No se ha podido preparar el editor."}
        </p>
      </div>
    );
  }

  const typeUsage = usageForType(company, documentType);

  return (
    <form className="space-y-6" onSubmit={handleSave}>
      {typeUsage.warning ? (
        <aside
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
          aria-live="polite"
        >
          <p className="font-medium">
            {typeUsage.reached
              ? `Has alcanzado el límite mensual de ${documentTypePlural(documentType)}.`
              : `Has emitido ${typeUsage.used} de ${typeUsage.limit} ${documentTypePlural(documentType)} este mes.`}
          </p>
          <p className="mt-1">
            Puedes seguir creando y guardando borradores sin consumir cupo.
          </p>
        </aside>
      ) : null}
      <section className="rounded-xl border bg-card p-5 shadow-sm sm:p-6">
        <div className="grid gap-5 lg:grid-cols-2">
          <DocumentTypeSelector
            value={documentType}
            onChange={setDocumentType}
          />
          <ClientPicker value={client} onChange={setClient} />
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="invoice-issue-date">Fecha de emisión</Label>
              <Input
                id="invoice-issue-date"
                type="date"
                required
                value={issueDate}
                onChange={(event) => {
                  const nextIssueDate = event.target.value;
                  setIssueDate(nextIssueDate);
                  if (nextIssueDate) {
                    setDueDate(
                      addCalendarDays(nextIssueDate, company.default_due_days),
                    );
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice-due-date">Fecha de vencimiento</Label>
              <Input
                id="invoice-due-date"
                type="date"
                min={issueDate}
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
          </div>
        </div>
      </section>

      <InvoiceLines
        lines={lines}
        calculation={calculation}
        defaultTaxRate={company.default_tax_rate}
        onChange={setLines}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <Label htmlFor="invoice-notes">Notas (opcional)</Label>
          <textarea
            id="invoice-notes"
            className="mt-2 min-h-32 w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            maxLength={5000}
            placeholder="Condiciones, referencia o mensaje para el cliente"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </section>

        <aside
          className="rounded-xl border bg-card p-5 shadow-sm"
          aria-labelledby="invoice-summary-title"
        >
          <h2 id="invoice-summary-title" className="font-semibold">
            Resumen
          </h2>
          {calculation ? (
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Base imponible</dt>
                <dd>{formatEur(createCents(calculation.subtotalCents))}</dd>
              </div>
              {calculation.taxBreakdown.map((tax) => (
                <div key={tax.rate} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">
                    IVA {Number(tax.rate).toLocaleString("es-ES")} %
                  </dt>
                  <dd>{formatEur(createCents(tax.taxCents))}</dd>
                </div>
              ))}
              {calculation.retentionCents > 0 ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">
                    Retención (
                    {Number(company.retention_rate).toLocaleString("es-ES")} %)
                  </dt>
                  <dd>-{formatEur(createCents(calculation.retentionCents))}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-4 border-t pt-3 text-base font-semibold">
                <dt>Total</dt>
                <dd>{formatEur(createCents(calculation.totalCents))}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Completa cantidad, precio e IVA para ver los totales.
            </p>
          )}
        </aside>
      </div>

      {loadError ? (
        <p role="alert" className="text-sm text-destructive">
          {loadError}
        </p>
      ) : null}
      {saveAction.error ? (
        <p role="alert" className="text-sm text-destructive">
          {saveAction.error}
        </p>
      ) : null}

      <div className="sticky bottom-4 flex flex-col-reverse gap-2 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" asChild>
          <Link href={documentId ? `/documents/${documentId}` : "/documents"}>
            Cancelar
          </Link>
        </Button>
        <Button type="submit" disabled={saveAction.isLoading}>
          {saveAction.isLoading ? "Guardando borrador…" : "Guardar borrador"}
        </Button>
      </div>
    </form>
  );
}

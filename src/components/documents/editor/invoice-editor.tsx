"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { ClientPicker } from "@/components/documents/editor/client-picker";
import {
  DocumentTypeSelector,
  type EditableDocumentType,
} from "@/components/documents/editor/document-type-selector";
import {
  createInitialEditorLine,
  InvoiceLines,
} from "@/components/documents/editor/invoice-lines";
import { useAsyncAction } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, jsonRequest } from "@/lib/api/client";
import { calculateBilling } from "@/lib/billing";
import { createCents, formatEur, parseEuroInput } from "@/lib/money";

import type { CreatedDraft, EditorCompany, EditorLine } from "./types";

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

export function InvoiceEditor() {
  const router = useRouter();
  const [company, setCompany] = useState<EditorCompany>();
  const [documentType, setDocumentType] =
    useState<EditableDocumentType>("invoice");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [issueDate, setIssueDate] = useState(() => madridToday());
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<EditorLine[]>(() => [
    createInitialEditorLine(),
  ]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const saveAction = useAsyncAction<CreatedDraft>();

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<EditorCompany>("/api/v1/company", {
      signal: controller.signal,
    })
      .then((companyResult) => {
        setCompany(companyResult);
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
  }, []);

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
    const created = await saveAction.run(() =>
      apiRequest<CreatedDraft>(
        "/api/v1/documents",
        jsonRequest("POST", {
          doc_type: documentType,
          client_id: selectedClientId || null,
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
    if (created) {
      router.push(`/documents/${created.id}`);
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

  return (
    <form className="space-y-6" onSubmit={handleSave}>
      {company.usage_warning ||
      company.docs_issued_this_month >= company.doc_limit ? (
        <aside
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
          aria-live="polite"
        >
          <p className="font-medium">
            {company.docs_issued_this_month >= company.doc_limit
              ? "Has alcanzado el límite mensual de emisiones."
              : `Has emitido ${company.docs_issued_this_month} de ${company.doc_limit} documentos este mes.`}
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
          <ClientPicker
            selectedId={selectedClientId}
            onChange={setSelectedClientId}
          />
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
          <Link href="/documents">Cancelar</Link>
        </Button>
        <Button type="submit" disabled={saveAction.isLoading}>
          {saveAction.isLoading ? "Guardando borrador…" : "Guardar borrador"}
        </Button>
      </div>
    </form>
  );
}

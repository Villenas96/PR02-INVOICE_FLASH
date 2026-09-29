"use client";

import { useCallback, useEffect, useState } from "react";

import { PlanIndicator } from "@/components/plan/plan-indicator";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api/client";
import {
  CompanyProfileForm,
  InvoicingPreferencesForm,
} from "./company-settings";
import { LogoSettings } from "./logo-settings";
import { SeriesSettings } from "./series-settings";
import type { CompanySettings, DocumentSeries, SeriesPage } from "./types";

export function SettingsPanel() {
  const [company, setCompany] = useState<CompanySettings>();
  const [series, setSeries] = useState<DocumentSeries[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string>();

  const loadInitial = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setError(undefined);
    try {
      const [companyResult, seriesResult] = await Promise.all([
        apiRequest<CompanySettings>("/api/v1/company", { signal }),
        apiRequest<SeriesPage>("/api/v1/series?limit=25", { signal }),
      ]);
      setCompany(companyResult);
      setSeries(seriesResult.items);
      setNextCursor(seriesResult.next_cursor);
    } catch (loadError) {
      if (
        loadError instanceof DOMException &&
        loadError.name === "AbortError"
      ) {
        return;
      }
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se ha podido cargar la configuración.",
      );
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadInitial(controller.signal);
    return () => controller.abort();
  }, [loadInitial]);

  async function loadMore() {
    if (!nextCursor || isLoadingMore) {
      return;
    }
    setIsLoadingMore(true);
    setError(undefined);
    try {
      const page = await apiRequest<SeriesPage>(
        `/api/v1/series?limit=25&cursor=${encodeURIComponent(nextCursor)}`,
      );
      setSeries((current) => {
        const knownIds = new Set(current.map((item) => item.id));
        return [
          ...current,
          ...page.items.filter((item) => !knownIds.has(item.id)),
        ];
      });
      setNextCursor(page.next_cursor);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se han podido cargar más series.",
      );
    } finally {
      setIsLoadingMore(false);
    }
  }

  function updateSeries(updated: DocumentSeries) {
    setSeries((current) =>
      current.map((item) => {
        if (item.id === updated.id) {
          return updated;
        }
        if (
          updated.is_default &&
          item.doc_type === updated.doc_type &&
          item.is_default
        ) {
          return { ...item, is_default: false };
        }
        return item;
      }),
    );
  }

  function addSeries(created: DocumentSeries) {
    setSeries((current) => {
      const normalized = created.is_default
        ? current.map((item) =>
            item.doc_type === created.doc_type
              ? { ...item, is_default: false }
              : item,
          )
        : current;
      return [created, ...normalized];
    });
  }

  if (isLoading) {
    return (
      <div className="grid gap-4" aria-busy="true" aria-live="polite">
        <span className="sr-only">Cargando configuración…</span>
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="h-40 animate-pulse rounded-xl border bg-muted/50"
          />
        ))}
      </div>
    );
  }

  if (!company) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6">
        <p
          role="alert"
          className="text-sm text-[color-mix(in_oklch,var(--destructive),var(--foreground)_35%)]"
        >
          {error ?? "No se ha podido cargar la configuración."}
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-4"
          onClick={() => loadInitial()}
        >
          Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <p className="font-medium">
            {company.is_ready_to_issue
              ? "Tu empresa está lista para emitir"
              : "Faltan datos fiscales para poder emitir"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {company.plan === "free" ? "Plan gratuito" : "Plan Pro"} · consumo
            del mes natural de Madrid
          </p>
        </div>
        <PlanIndicator
          plan={company.plan}
          issuedDocuments={company.docs_issued_this_month}
          documentLimit={company.doc_limit}
          className="w-full sm:w-56"
        />
        <ul className="text-xs text-muted-foreground sm:text-right">
          <li>PDF y enlace profesional incluidos</li>
          <li>
            Email:{" "}
            {company.can_send_email ? "incluido" : "disponible en Plan Pro"}
          </li>
        </ul>
      </section>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-[color-mix(in_oklch,var(--destructive),var(--foreground)_35%)]"
        >
          {error}
        </p>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <CompanyProfileForm company={company} onChange={setCompany} />
        <div className="space-y-6">
          <LogoSettings
            logoKey={company.logo_key}
            onChange={(logoKey) =>
              setCompany((current) =>
                current ? { ...current, logo_key: logoKey } : current,
              )
            }
          />
          <InvoicingPreferencesForm company={company} onChange={setCompany} />
        </div>
      </div>

      <SeriesSettings
        items={series}
        nextCursor={nextCursor}
        onCreate={addSeries}
        onUpdate={updateSeries}
        onLoadMore={loadMore}
        isLoadingMore={isLoadingMore}
      />
    </div>
  );
}

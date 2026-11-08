"use client";

import Link from "next/link";
import { useState } from "react";

import { useMutation } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { apiRequest, jsonRequest } from "@/lib/api/client";

import { ExportResult } from "./export-result";
import { useExportJob } from "./use-export-job";

const PERIODS = [
  ["previous_quarter", "Trimestre anterior"],
  ["current_quarter", "Trimestre actual"],
  ["previous_month", "Mes anterior"],
  ["current_month", "Mes actual"],
  ["year", "Año en curso"],
] as const;

/**
 * Essential and Pro (FR-032): the period's invoices as a spreadsheet,
 * downloaded or sent to the advisor as an expiring link.
 */
export function PeriodExport({
  advisorEmail,
  canSend,
}: {
  advisorEmail: string | null;
  /** Owners only: an advisor exports but never sends to the advisor. */
  canSend: boolean;
}) {
  const [period, setPeriod] =
    useState<(typeof PERIODS)[number][0]>("previous_quarter");
  const action = useMutation<{ export_id: string }>();
  const { job, track, isWaiting } = useExportJob();

  async function start(sendToAdvisor: boolean) {
    const created = await action.run(() =>
      apiRequest<{ export_id: string }>(
        "/api/v1/exports",
        jsonRequest("POST", {
          kind: "period_excel",
          period,
          ...(sendToAdvisor ? { send_to_advisor: true } : {}),
        }),
      ),
    );
    if (created) {
      track(created.export_id);
    }
  }

  return (
    <section
      aria-labelledby="period-export-title"
      className="space-y-4 rounded-xl border bg-card p-5 shadow-sm sm:p-6"
    >
      <div className="space-y-1">
        <h2 id="period-export-title" className="text-lg font-semibold">
          Exportar para mi gestoría
        </h2>
        <p className="text-sm text-muted-foreground">
          Excel con una fila por factura y su desglose de impuestos, retención y
          estado de cobro.
        </p>
      </div>
      <div className="max-w-xs space-y-2">
        <Label htmlFor="export-period">Periodo</Label>
        <select
          id="export-period"
          className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          value={period}
          onChange={(event) =>
            setPeriod(event.target.value as (typeof PERIODS)[number][0])
          }
        >
          {PERIODS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={action.isLoading || isWaiting}
          onClick={() => start(false)}
        >
          Descargar Excel
        </Button>
        {canSend ? (
          <Button
            type="button"
            variant="outline"
            disabled={action.isLoading || isWaiting || !advisorEmail}
            onClick={() => start(true)}
          >
            Enviar a mi asesoría
          </Button>
        ) : null}
      </div>
      {canSend ? (
        <p className="text-xs text-muted-foreground">
          {advisorEmail ? (
            <>Se enviará un enlace de descarga a {advisorEmail}.</>
          ) : (
            <>
              Para enviarlo, indica el email de tu asesoría{" "}
              <Link className="underline" href="#advisor-email">
                más abajo
              </Link>
              .
            </>
          )}
        </p>
      ) : null}
      {action.error ? (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      ) : null}
      <ExportResult job={job} isWaiting={isWaiting} />
    </section>
  );
}

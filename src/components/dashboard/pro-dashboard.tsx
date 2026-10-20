"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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
import { apiRequest } from "@/lib/api/client";
import { type ExportPeriod, resolvePeriod } from "@/lib/exports/period";
import { createCents, formatEur } from "@/lib/money";

import { InvoicedVsCollectedChart, type MonthlyPoint } from "./pro-charts";

interface FullTotals {
  invoiced_base_cents: number;
  invoiced_total_cents: number;
  invoice_count: number;
  tax_collected: Array<{
    name: string;
    rate: string;
    base_cents: number;
    tax_cents: number;
  }>;
  paid_cents: number;
  pending_cents: number;
  overdue_cents: number;
}

interface TopClient {
  client_id: string | null;
  name: string;
  invoiced_cents: number;
  invoice_count: number;
}

interface Treasury {
  balance_cents: number | null;
  balance_on: string | null;
  expected_30_days_cents: number;
  overdue_cents: number;
}

const PRESETS: Array<[ExportPeriod | "all" | "custom", string]> = [
  ["all", "Todo"],
  ["current_month", "Este mes"],
  ["previous_month", "Mes anterior"],
  ["current_quarter", "Este trimestre"],
  ["previous_quarter", "Trimestre anterior"],
  ["year", "Este año"],
  ["custom", "Personalizado"],
];

function euros(cents: number): string {
  return formatEur(createCents(cents));
}

function formattedDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * Pro summary (FR-046, FR-047): figures for a period, 12-month chart, top
 * clients and treasury. Every number comes from the API, derived from issued
 * invoices and payments.
 */
export function ProDashboard() {
  const [preset, setPreset] = useState<ExportPeriod | "all" | "custom">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [totals, setTotals] = useState<FullTotals | null>(null);
  const [monthly, setMonthly] = useState<MonthlyPoint[]>([]);
  const [clients, setClients] = useState<TopClient[]>([]);
  const [treasury, setTreasury] = useState<Treasury | null>(null);
  const [error, setError] = useState(false);

  function choose(next: ExportPeriod | "all" | "custom") {
    setPreset(next);
    if (next === "all") {
      setFrom("");
      setTo("");
    } else if (next !== "custom") {
      const period = resolvePeriod(next, new Date());
      setFrom(period.from);
      setTo(period.to);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams();
    if (from) {
      params.set("from", from);
    }
    if (to) {
      params.set("to", to);
    }
    const query = params.size > 0 ? `?${params}` : "";
    Promise.all([
      apiRequest<FullTotals>(`/api/v1/dashboard${query}`),
      apiRequest<{ items: TopClient[] }>(
        `/api/v1/dashboard/top-clients${query}`,
      ),
    ])
      .then(([base, top]) => {
        setTotals(base);
        setClients(top.items);
        setError(false);
      })
      .catch(() => setError(true));
  }, [from, to]);

  useEffect(() => {
    apiRequest<{ items: MonthlyPoint[] }>("/api/v1/dashboard/monthly")
      .then((page) => setMonthly(page.items))
      .catch(() => setMonthly([]));
    apiRequest<Treasury>("/api/v1/dashboard/treasury")
      .then(setTreasury)
      .catch(() => setTreasury(null));
  }, []);

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="period-title"
        className="flex flex-wrap items-end gap-4 rounded-xl border bg-card p-4 shadow-sm"
      >
        <h2 id="period-title" className="sr-only">
          Periodo
        </h2>
        <div className="space-y-2">
          <Label htmlFor="dashboard-period">Periodo</Label>
          <select
            id="dashboard-period"
            className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
            value={preset}
            onChange={(event) =>
              choose(event.target.value as ExportPeriod | "all" | "custom")
            }
          >
            {PRESETS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {preset === "custom" ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="dashboard-from">Desde</Label>
              <Input
                id="dashboard-from"
                type="date"
                value={from}
                max={to || undefined}
                onChange={(event) => setFrom(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dashboard-to">Hasta</Label>
              <Input
                id="dashboard-to"
                type="date"
                value={to}
                min={from || undefined}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>
          </>
        ) : null}
      </section>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          No se han podido cargar las cifras.
        </p>
      ) : null}

      <section aria-labelledby="figures-title" className="space-y-3">
        <h2 id="figures-title" className="text-lg font-semibold">
          Resumen del periodo
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="Facturado (con impuestos)"
            value={euros(totals?.invoiced_total_cents ?? 0)}
            hint={`${totals?.invoice_count ?? 0} facturas · base ${euros(totals?.invoiced_base_cents ?? 0)}`}
          />
          <Tile label="Cobrado" value={euros(totals?.paid_cents ?? 0)} />
          <Tile label="Pendiente" value={euros(totals?.pending_cents ?? 0)} />
          <Tile label="Vencido" value={euros(totals?.overdue_cents ?? 0)} />
        </div>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section
          aria-labelledby="taxes-title"
          className="rounded-xl border bg-card p-5 shadow-sm"
        >
          <h2 id="taxes-title" className="mb-3 text-lg font-semibold">
            Impuestos repercutidos
          </h2>
          {totals && totals.tax_collected.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Impuesto</TableHead>
                  <TableHead className="text-right">Base</TableHead>
                  <TableHead className="text-right">Cuota</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {totals.tax_collected.map((tax) => (
                  <TableRow key={`${tax.name}-${tax.rate}`}>
                    <TableCell>
                      {tax.name} {Number(tax.rate).toLocaleString("es-ES")} %
                    </TableCell>
                    <TableCell className="text-right">
                      {euros(tax.base_cents)}
                    </TableCell>
                    <TableCell className="text-right">
                      {euros(tax.tax_cents)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">
              No hay facturas emitidas en este periodo.
            </p>
          )}
        </section>

        <section
          aria-labelledby="treasury-title"
          className="space-y-3 rounded-xl border bg-card p-5 shadow-sm"
        >
          <h2 id="treasury-title" className="text-lg font-semibold">
            Tesorería
          </h2>
          {treasury ? (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">
                  Saldo del banco
                  {treasury.balance_on
                    ? ` (${formattedDate(treasury.balance_on)})`
                    : ""}
                </dt>
                <dd className="font-medium">
                  {treasury.balance_cents === null
                    ? "Sin extracto"
                    : euros(treasury.balance_cents)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">
                  Cobros previstos a 30 días
                </dt>
                <dd className="font-medium">
                  {euros(treasury.expected_30_days_cents)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Ya vencido</dt>
                <dd className="font-medium">{euros(treasury.overdue_cents)}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          )}
          {treasury && treasury.balance_cents === null ? (
            <p className="text-xs text-muted-foreground">
              Importa un extracto en{" "}
              <Link className="underline" href="/reconciliation">
                Conciliación
              </Link>{" "}
              para ver el saldo.
            </p>
          ) : null}
        </section>
      </div>

      <section
        aria-labelledby="chart-title"
        className="rounded-xl border bg-card p-5 shadow-sm"
      >
        <h2 id="chart-title" className="mb-3 text-lg font-semibold">
          Facturado y cobrado · 12 meses
        </h2>
        <InvoicedVsCollectedChart data={monthly} />
      </section>

      <section
        aria-labelledby="top-title"
        className="rounded-xl border bg-card p-5 shadow-sm"
      >
        <h2 id="top-title" className="mb-3 text-lg font-semibold">
          Mejores clientes
        </h2>
        {clients.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Todavía no hay facturas.
          </p>
        ) : (
          <ol className="divide-y">
            {clients.map((client, index) => (
              <li
                key={client.client_id ?? `none-${index}`}
                className="flex items-center justify-between gap-4 py-2 text-sm"
              >
                <span>
                  {index + 1}.{" "}
                  {client.client_id ? (
                    <Link
                      className="underline-offset-4 hover:underline"
                      href={`/clients/${client.client_id}`}
                    >
                      {client.name}
                    </Link>
                  ) : (
                    client.name
                  )}
                  <span className="ml-2 text-muted-foreground">
                    {client.invoice_count} facturas
                  </span>
                </span>
                <span className="font-medium">
                  {euros(client.invoiced_cents)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

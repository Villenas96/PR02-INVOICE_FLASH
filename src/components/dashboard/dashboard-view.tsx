"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

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
import { apiRequest } from "@/lib/api/client";
import { createCents, formatEur } from "@/lib/money";

type PaymentStatus = "overdue" | "paid" | "partial" | "pending";

interface DashboardTotals {
  paid_cents: number;
  pending_cents: number;
  overdue_cents: number;
  counts_by_status: Record<PaymentStatus, number>;
}

interface InvoiceListItem {
  id: string;
  full_number: string | null;
  client_id: string | null;
  issue_date: string;
  due_date: string | null;
  total_cents: number;
  paid_cents: number;
  outstanding_cents: number;
  payment_status: PaymentStatus | null;
}

interface InvoicePage {
  items: InvoiceListItem[];
  next_cursor: string | null;
}

interface ClientOption {
  id: string;
  name: string;
}

const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  pending: "Pendiente",
  partial: "Parcial",
  paid: "Pagada",
  overdue: "Vencida",
};

function paymentVariant(status: PaymentStatus) {
  if (status === "overdue") {
    return "destructive" as const;
  }
  return status === "paid" ? ("default" as const) : ("outline" as const);
}

function formattedDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

export function DashboardView() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [clientId, setClientId] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [totals, setTotals] = useState<DashboardTotals>();
  const [items, setItems] = useState<InvoiceListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    apiRequest<{ items: ClientOption[] }>("/api/v1/clients?limit=100")
      .then((page) => setClients(page.items))
      .catch(() => setClients([]));
  }, []);

  const dashboardPath = useCallback(() => {
    const params = new URLSearchParams();
    if (from) {
      params.set("from", from);
    }
    if (to) {
      params.set("to", to);
    }
    const query = params.toString();
    return query ? `/api/v1/dashboard?${query}` : "/api/v1/dashboard";
  }, [from, to]);

  const documentsPath = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams({ type: "invoice", limit: "25" });
      if (from) {
        params.set("from", from);
      }
      if (to) {
        params.set("to", to);
      }
      if (clientId) {
        params.set("client_id", clientId);
      }
      if (paymentStatus) {
        params.set("payment_status", paymentStatus);
      }
      if (cursor) {
        params.set("cursor", cursor);
      }
      return `/api/v1/documents?${params.toString()}`;
    },
    [clientId, from, paymentStatus, to],
  );

  const loadFirstPage = useCallback(
    async (signal?: AbortSignal) => {
      setIsLoading(true);
      setError(undefined);
      try {
        const [dashboardTotals, documentPage] = await Promise.all([
          apiRequest<DashboardTotals>(dashboardPath(), { signal }),
          apiRequest<InvoicePage>(documentsPath(), { signal }),
        ]);
        setTotals(dashboardTotals);
        setItems(documentPage.items);
        setNextCursor(documentPage.next_cursor);
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
            : "No se ha podido cargar el panel de cobros.",
        );
      } finally {
        if (!signal?.aborted) {
          setIsLoading(false);
        }
      }
    },
    [dashboardPath, documentsPath],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadFirstPage(controller.signal);
    return () => controller.abort();
  }, [loadFirstPage]);

  async function loadMore() {
    if (!nextCursor || isLoadingMore) {
      return;
    }
    setIsLoadingMore(true);
    setError(undefined);
    try {
      const page = await apiRequest<InvoicePage>(documentsPath(nextCursor));
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.next_cursor);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se han podido cargar más facturas.",
      );
    } finally {
      setIsLoadingMore(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor="dashboard-from">Desde</Label>
          <Input
            id="dashboard-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dashboard-to">Hasta</Label>
          <Input
            id="dashboard-to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dashboard-client">Cliente</Label>
          <select
            id="dashboard-client"
            className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
          >
            <option value="">Todos</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="dashboard-status">Estado de cobro</Label>
          <select
            id="dashboard-status"
            className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
            value={paymentStatus}
            onChange={(event) => setPaymentStatus(event.target.value)}
          >
            <option value="">Todos</option>
            <option value="pending">Pendiente</option>
            <option value="partial">Parcial</option>
            <option value="paid">Pagada</option>
            <option value="overdue">Vencida</option>
          </select>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p
            role="alert"
            className="text-sm text-[color-mix(in_oklch,var(--destructive),var(--foreground)_35%)]"
          >
            {error}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => loadFirstPage()}
          >
            Reintentar
          </Button>
        </div>
      ) : null}

      {isLoading ? (
        <output className="block h-40 animate-pulse rounded-xl border bg-muted/50">
          <span className="sr-only">Cargando panel de cobros…</span>
        </output>
      ) : totals ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <p className="text-sm text-muted-foreground">Cobrado</p>
            <p
              className="mt-1 text-2xl font-semibold"
              data-testid="dashboard-paid-total"
            >
              {formatEur(createCents(totals.paid_cents))}
            </p>
          </div>
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <p className="text-sm text-muted-foreground">Pendiente</p>
            <p
              className="mt-1 text-2xl font-semibold"
              data-testid="dashboard-pending-total"
            >
              {formatEur(createCents(totals.pending_cents))}
            </p>
          </div>
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <p className="text-sm text-destructive">Vencido</p>
            <p
              className="mt-1 text-2xl font-semibold text-destructive"
              data-testid="dashboard-overdue-total"
            >
              {formatEur(createCents(totals.overdue_cents))}
            </p>
          </div>
        </div>
      ) : null}

      {!isLoading && items.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-10 text-center">
          <h2 className="font-semibold">No hay facturas con estos filtros</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Ajusta el periodo, el cliente o el estado de cobro.
          </p>
        </div>
      ) : !isLoading ? (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Factura</TableHead>
                <TableHead>Emisión</TableHead>
                <TableHead>Vencimiento</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Cobrado</TableHead>
                <TableHead className="text-right">Pendiente</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((invoice) => (
                <TableRow
                  key={invoice.id}
                  className={
                    invoice.payment_status === "overdue"
                      ? "border-l-2 border-l-destructive"
                      : undefined
                  }
                >
                  <TableCell>
                    <Link
                      className="font-medium underline-offset-4 hover:underline"
                      href={`/documents/${invoice.id}`}
                    >
                      {invoice.full_number ?? invoice.id}
                    </Link>
                  </TableCell>
                  <TableCell>{formattedDate(invoice.issue_date)}</TableCell>
                  <TableCell>
                    {invoice.due_date ? formattedDate(invoice.due_date) : "—"}
                  </TableCell>
                  <TableCell>
                    {invoice.payment_status ? (
                      <Badge variant={paymentVariant(invoice.payment_status)}>
                        {PAYMENT_LABELS[invoice.payment_status]}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatEur(createCents(invoice.paid_cents))}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatEur(createCents(invoice.outstanding_cents))}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatEur(createCents(invoice.total_cents))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {nextCursor && !isLoading ? (
        <Button
          type="button"
          variant="outline"
          disabled={isLoadingMore}
          onClick={loadMore}
        >
          {isLoadingMore ? "Cargando…" : "Cargar más facturas"}
        </Button>
      ) : null}
    </div>
  );
}

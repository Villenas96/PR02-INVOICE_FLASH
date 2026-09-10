"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

type DocumentType = "invoice" | "proforma" | "receipt";
type DocumentStatus = "draft" | "issued" | "voided";
type PaymentStatus = "overdue" | "paid" | "partial" | "pending";

interface DocumentListItem {
  id: string;
  doc_type: DocumentType;
  status: DocumentStatus;
  full_number: string | null;
  client_id: string | null;
  issue_date: string;
  due_date: string | null;
  total_cents: number;
  pdf_status: "failed" | "pending" | "ready" | null;
  issued_at: string | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
  paid_cents: number;
  outstanding_cents: number;
  payment_status: PaymentStatus | null;
}

interface DocumentPage {
  items: DocumentListItem[];
  next_cursor: string | null;
}

const typeLabels: Record<DocumentType, string> = {
  invoice: "Factura",
  proforma: "Proforma",
  receipt: "Recibo",
};

const statusLabels: Record<DocumentStatus, string> = {
  draft: "Borrador",
  issued: "Emitida",
  voided: "Anulada",
};

const paymentLabels: Record<PaymentStatus, string> = {
  overdue: "Vencida",
  paid: "Pagada",
  partial: "Parcial",
  pending: "Pendiente",
};

function formattedDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

function statusVariant(status: DocumentStatus) {
  if (status === "voided") {
    return "destructive" as const;
  }
  return status === "issued" ? ("default" as const) : ("secondary" as const);
}

function paymentVariant(status: PaymentStatus) {
  if (status === "overdue") {
    return "destructive" as const;
  }
  return status === "paid" ? ("default" as const) : ("outline" as const);
}

export function DocumentList() {
  const [documentType, setDocumentType] = useState("");
  const [documentStatus, setDocumentStatus] = useState("");
  const [items, setItems] = useState<DocumentListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string>();

  const queryPath = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams({ limit: "25" });
      if (documentType) {
        params.set("type", documentType);
      }
      if (documentStatus) {
        params.set("status", documentStatus);
      }
      if (cursor) {
        params.set("cursor", cursor);
      }
      return `/api/v1/documents?${params.toString()}`;
    },
    [documentStatus, documentType],
  );

  const loadFirstPage = useCallback(
    async (signal?: AbortSignal) => {
      setIsLoading(true);
      setError(undefined);
      try {
        const page = await apiRequest<DocumentPage>(queryPath(), { signal });
        setItems(page.items);
        setNextCursor(page.next_cursor);
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
            : "No se han podido cargar los documentos.",
        );
      } finally {
        if (!signal?.aborted) {
          setIsLoading(false);
        }
      }
    },
    [queryPath],
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
      const page = await apiRequest<DocumentPage>(queryPath(nextCursor));
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.next_cursor);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se han podido cargar más documentos.",
      );
    } finally {
      setIsLoadingMore(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-end">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="document-type-filter">
            Tipo
          </label>
          <select
            id="document-type-filter"
            className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm sm:w-40"
            value={documentType}
            onChange={(event) => setDocumentType(event.target.value)}
          >
            <option value="">Todos</option>
            <option value="invoice">Facturas</option>
            <option value="proforma">Proformas</option>
            <option value="receipt">Recibos</option>
          </select>
        </div>
        <div className="space-y-2">
          <label
            className="text-sm font-medium"
            htmlFor="document-status-filter"
          >
            Estado
          </label>
          <select
            id="document-status-filter"
            className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm sm:w-40"
            value={documentStatus}
            onChange={(event) => setDocumentStatus(event.target.value)}
          >
            <option value="">Todos</option>
            <option value="draft">Borradores</option>
            <option value="issued">Emitidos</option>
            <option value="voided">Anulados</option>
          </select>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p role="alert" className="text-sm text-destructive">
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
        <output className="block h-64 animate-pulse rounded-xl border bg-muted/50">
          <span className="sr-only">Cargando documentos…</span>
        </output>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-10 text-center">
          <h2 className="font-semibold">Todavía no hay documentos</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Crea un borrador para preparar tu primera factura.
          </p>
          <Button asChild className="mt-4">
            <Link href="/documents/new">Nueva factura</Link>
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Documento</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Vencimiento</TableHead>
                <TableHead>Cobro</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((document) => (
                <TableRow key={document.id}>
                  <TableCell>
                    <Link
                      className="font-medium underline-offset-4 hover:underline"
                      href={`/documents/${document.id}`}
                    >
                      {document.full_number ?? "Borrador sin número"}
                    </Link>
                    <div className="mt-1">
                      <Badge variant="outline">
                        {typeLabels[document.doc_type]}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(document.status)}>
                      {statusLabels[document.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>{formattedDate(document.issue_date)}</TableCell>
                  <TableCell>
                    {document.due_date ? formattedDate(document.due_date) : "—"}
                  </TableCell>
                  <TableCell>
                    {document.payment_status ? (
                      <Badge variant={paymentVariant(document.payment_status)}>
                        {paymentLabels[document.payment_status]}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatEur(createCents(document.total_cents))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {nextCursor && !isLoading ? (
        <Button
          type="button"
          variant="outline"
          disabled={isLoadingMore}
          onClick={loadMore}
        >
          {isLoadingMore ? "Cargando…" : "Cargar más documentos"}
        </Button>
      ) : null}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { IssueAction } from "@/components/documents/editor/issue-action";
import { PdfDownload } from "@/components/documents/pdf-download";
import { useAsyncAction } from "@/components/ui/async-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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

type DocumentStatus = "draft" | "issued" | "voided";
type PdfStatus = "failed" | "pending" | "ready";

interface TaxEntry {
  rate: string;
  baseCents: number;
  taxCents: number;
}

interface DocumentLine {
  id: string;
  position: number;
  description: string;
  quantity: string;
  unit_price_cents: number;
  tax_rate: string;
  discount_pct: string;
  line_subtotal_cents: number;
  line_tax_cents: number;
  line_total_cents: number;
}

interface DocumentEvent {
  id: string;
  actor: string;
  event: string;
  payload: unknown;
  created_at: string;
}

interface IssuerSnapshot {
  legalName: string;
  taxId: string;
  address: string;
  email: string;
  phone: string | null;
  logoKey: string | null;
}

interface ClientSnapshot {
  name: string;
  taxId: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
}

interface DocumentDetailData {
  id: string;
  doc_type: "invoice" | "proforma" | "receipt";
  status: DocumentStatus;
  full_number: string | null;
  client_id: string | null;
  issue_date: string;
  due_date: string | null;
  notes: string | null;
  subtotal_cents: number;
  tax_breakdown: TaxEntry[];
  retention_rate: string;
  retention_cents: number;
  total_cents: number;
  issuer_snapshot: IssuerSnapshot | null;
  client_snapshot: ClientSnapshot | null;
  pdf_status: PdfStatus | null;
  issued_at: string | null;
  voided_at: string | null;
  lines: DocumentLine[];
  events: DocumentEvent[];
  paid_cents: number;
  outstanding_cents: number;
  payment_status: "overdue" | "paid" | "partial" | "pending" | null;
}

interface CompanyCapabilityData {
  is_ready_to_issue: boolean;
  docs_issued_this_month: number;
  doc_limit: number;
}

const eventLabels: Record<string, string> = {
  created: "Borrador creado",
  updated: "Borrador actualizado",
  issued: "Documento emitido",
  voided: "Documento anulado",
  pdf_generated: "PDF generado",
  pdf_failed: "Falló la generación del PDF",
  payment_added: "Pago registrado",
  payment_updated: "Pago actualizado",
  payment_deleted: "Pago eliminado",
};

function formattedDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

function formattedDateTime(date: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Madrid",
  }).format(new Date(date));
}

function statusBadge(status: DocumentStatus) {
  if (status === "voided") {
    return <Badge variant="destructive">Anulada</Badge>;
  }
  return status === "issued" ? (
    <Badge>Emitida</Badge>
  ) : (
    <Badge variant="secondary">Borrador</Badge>
  );
}

function VoidAction({
  documentId,
  onVoided,
}: {
  documentId: string;
  onVoided: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const action = useAsyncAction<unknown>();

  async function handleVoid() {
    const result = await action.run(() =>
      apiRequest<unknown>(`/api/v1/documents/${documentId}/void`, {
        method: "POST",
      }),
    );
    if (result !== undefined) {
      setOpen(false);
      await onVoided();
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="destructive">
          Anular factura
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Anular esta factura?</DialogTitle>
          <DialogDescription>
            La factura conservará su número y contenido. La anulación quedará
            registrada y no se puede deshacer.
          </DialogDescription>
        </DialogHeader>
        {action.error ? (
          <p role="alert" className="text-sm text-destructive">
            {action.error}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancelar
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={action.isLoading}
            onClick={handleVoid}
          >
            {action.isLoading ? "Anulando…" : "Confirmar anulación"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DocumentDetail({ documentId }: { documentId: string }) {
  const [document, setDocument] = useState<DocumentDetailData>();
  const [company, setCompany] = useState<CompanyCapabilityData>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();

  const loadDocument = useCallback(async () => {
    setError(undefined);
    try {
      const [detail, companyCapabilities] = await Promise.all([
        apiRequest<DocumentDetailData>(`/api/v1/documents/${documentId}`, {
          cache: "no-store",
        }),
        apiRequest<CompanyCapabilityData>("/api/v1/company", {
          cache: "no-store",
        }),
      ]);
      setDocument(detail);
      setCompany(companyCapabilities);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se ha podido cargar el documento.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    void loadDocument();
  }, [loadDocument]);

  if (isLoading) {
    return (
      <output className="block h-96 animate-pulse rounded-xl border bg-muted/50">
        <span className="sr-only">Cargando documento…</span>
      </output>
    );
  }
  if (!document) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6">
        <p role="alert" className="text-sm text-destructive">
          {error ?? "No se ha podido cargar el documento."}
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-4"
          onClick={loadDocument}
        >
          Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-5 rounded-xl border bg-card p-5 shadow-sm sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {statusBadge(document.status)}
            <span className="text-sm text-muted-foreground">
              {document.doc_type === "invoice" ? "Factura" : "Documento"}
            </span>
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            {document.full_number ?? "Borrador sin número"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Emisión {formattedDate(document.issue_date)}
            {document.due_date
              ? ` · vencimiento ${formattedDate(document.due_date)}`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {document.status === "draft" && company ? (
            <IssueAction
              documentId={document.id}
              isCompanyReady={company.is_ready_to_issue}
              issuedDocuments={company.docs_issued_this_month}
              documentLimit={company.doc_limit}
              onIssued={loadDocument}
            />
          ) : null}
          {document.status === "issued" ? (
            <>
              {document.pdf_status ? (
                <PdfDownload
                  documentId={document.id}
                  fullNumber={document.full_number ?? document.id}
                  pdfStatus={document.pdf_status}
                />
              ) : null}
              <VoidAction documentId={document.id} onVoided={loadDocument} />
            </>
          ) : null}
          {document.status === "voided" && document.pdf_status ? (
            <PdfDownload
              documentId={document.id}
              fullNumber={document.full_number ?? document.id}
              pdfStatus={document.pdf_status}
            />
          ) : null}
        </div>
      </section>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {document.issuer_snapshot && document.client_snapshot ? (
        <section className="grid gap-6 rounded-xl border bg-card p-5 shadow-sm sm:grid-cols-2 sm:p-6">
          <div>
            <h2 className="font-semibold">Emisor al emitir</h2>
            <address className="mt-3 space-y-1 text-sm not-italic text-muted-foreground">
              <p className="font-medium text-foreground">
                {document.issuer_snapshot.legalName}
              </p>
              <p>{document.issuer_snapshot.taxId}</p>
              <p>{document.issuer_snapshot.address}</p>
              <p>{document.issuer_snapshot.email}</p>
            </address>
          </div>
          <div>
            <h2 className="font-semibold">Cliente al emitir</h2>
            <address className="mt-3 space-y-1 text-sm not-italic text-muted-foreground">
              <p className="font-medium text-foreground">
                {document.client_snapshot.name}
              </p>
              <p>{document.client_snapshot.taxId ?? "Sin NIF"}</p>
              <p>{document.client_snapshot.address ?? "Sin dirección"}</p>
              <p>{document.client_snapshot.email ?? "Sin correo"}</p>
            </address>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Esta instantánea es inmutable aunque cambien después los datos de
            empresa o cliente.
          </p>
        </section>
      ) : document.client_id ? (
        <section className="rounded-xl border bg-card p-5 text-sm shadow-sm">
          <p>
            Cliente seleccionado:{" "}
            <span className="font-mono text-xs">{document.client_id}</span>
          </p>
        </section>
      ) : null}

      <section className="rounded-xl border bg-card shadow-sm">
        <div className="p-5 pb-2">
          <h2 className="font-semibold">Conceptos</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Descripción</TableHead>
              <TableHead>Cantidad</TableHead>
              <TableHead className="text-right">Precio</TableHead>
              <TableHead className="text-right">IVA</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {document.lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell className="max-w-sm whitespace-normal">
                  {line.description}
                </TableCell>
                <TableCell>
                  {Number(line.quantity).toLocaleString("es-ES")}
                </TableCell>
                <TableCell className="text-right">
                  {formatEur(createCents(line.unit_price_cents))}
                </TableCell>
                <TableCell className="text-right">
                  {Number(line.tax_rate).toLocaleString("es-ES")} %
                </TableCell>
                <TableCell className="text-right font-medium">
                  {formatEur(createCents(line.line_total_cents))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="ml-auto w-full max-w-sm space-y-3 border-t p-5 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Base imponible</span>
            <span>{formatEur(createCents(document.subtotal_cents))}</span>
          </div>
          {document.tax_breakdown.map((tax) => (
            <div key={tax.rate} className="flex justify-between gap-4">
              <span className="text-muted-foreground">
                IVA {Number(tax.rate).toLocaleString("es-ES")} %
              </span>
              <span>{formatEur(createCents(tax.taxCents))}</span>
            </div>
          ))}
          {document.retention_cents > 0 ? (
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Retención</span>
              <span>-{formatEur(createCents(document.retention_cents))}</span>
            </div>
          ) : null}
          <div className="flex justify-between gap-4 border-t pt-3 text-base font-semibold">
            <span>Total</span>
            <span>{formatEur(createCents(document.total_cents))}</span>
          </div>
        </div>
      </section>

      {document.notes ? (
        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="font-semibold">Notas</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
            {document.notes}
          </p>
        </section>
      ) : null}

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="font-semibold">Historial</h2>
        {document.events.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Todavía no hay eventos.
          </p>
        ) : (
          <ol className="mt-4 space-y-4 border-l pl-5">
            {document.events.map((event) => (
              <li key={event.id} className="relative">
                <span className="absolute top-1.5 -left-[1.55rem] size-2 rounded-full bg-foreground" />
                <p className="text-sm font-medium">
                  {eventLabels[event.event] ?? event.event}
                </p>
                <time
                  className="text-xs text-muted-foreground"
                  dateTime={event.created_at}
                >
                  {formattedDateTime(event.created_at)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>

      <Button asChild variant="ghost">
        <Link href="/documents">Volver a documentos</Link>
      </Button>
    </div>
  );
}

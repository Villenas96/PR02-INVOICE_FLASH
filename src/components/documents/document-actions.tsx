"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useDuplicateDocument } from "@/components/documents/draft-actions";
import type { DocumentPayment } from "@/components/documents/payments-panel";
import { useMutation } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { apiRequest, jsonRequest } from "@/lib/api/client";
import { CONVERSION_TARGETS } from "@/lib/documents/conversion";
import { documentTypeLabel } from "@/lib/documents/labels";
import { createCents, formatEur } from "@/lib/money";
import type { DocumentType } from "@/lib/plan";

export interface LinkedDocument {
  id: string;
  kind: "converted" | "invoiced";
  doc_type: DocumentType;
  full_number: string | null;
  status: "draft" | "issued" | "voided";
}

interface DocumentActionsProps {
  documentId: string;
  documentType: DocumentType;
  status: "draft" | "issued" | "voided";
  /** Quote/delivery note state derived by the API. */
  derivedState: string | null;
  /** Documents created from this one (live links). */
  linkedTargets: LinkedDocument[];
  issuedDocuments: number;
  documentLimit: number;
  payments: DocumentPayment[];
  /** Pro (FR-033): the issued document as a spreadsheet. */
  canDownloadXlsx: boolean;
  /** Advisor (FR-051): only the spreadsheet download remains. */
  readOnly?: boolean;
  /** Reloads the document after an in-place change (quote decision). */
  onChanged?: () => void;
}

function formattedDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

function ConvertAction({
  documentId,
  issuedDocuments,
  documentLimit,
}: {
  documentId: string;
  issuedDocuments: number;
  documentLimit: number;
}) {
  const router = useRouter();
  const action = useMutation<{ id: string }>();
  const limitReached = issuedDocuments >= documentLimit;

  async function convert(issue: boolean) {
    const result = await action.run(() =>
      apiRequest<{ id: string }>(
        `/api/v1/documents/${documentId}/convert`,
        jsonRequest("POST", { issue }),
      ),
    );
    if (result) {
      router.push(`/documents/${result.id}`);
    }
  }

  return (
    <div>
      <h3 className="text-sm font-medium">Convertir en factura</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={action.isLoading || limitReached}
          onClick={() => convert(true)}
        >
          {action.isLoading ? "Convirtiendo…" : "Convertir y emitir factura"}
        </Button>
        {limitReached ? (
          <Button
            type="button"
            variant="outline"
            disabled={action.isLoading}
            onClick={() => convert(false)}
          >
            Guardar como borrador
          </Button>
        ) : null}
      </div>
      {limitReached ? (
        <p className="mt-2 max-w-md text-sm text-destructive">
          Has alcanzado el límite de {documentLimit} facturas de este mes.
          Puedes guardar la conversión como borrador sin consumir cupo y
          emitirla el mes que viene.
        </p>
      ) : null}
      {action.error ? (
        <p role="alert" className="mt-2 max-w-md text-sm text-destructive">
          {action.error}
        </p>
      ) : null}
    </div>
  );
}

function ConvertToType({
  documentId,
  targetType,
  existing,
  showExisting = true,
}: {
  documentId: string;
  targetType: DocumentType;
  existing: LinkedDocument[];
  /** Off when the caller already tells where it was converted. */
  showExisting?: boolean;
}) {
  const router = useRouter();
  const action = useMutation<{ id: string }>();
  const [confirming, setConfirming] = useState(false);
  const label = documentTypeLabel(targetType).toLowerCase();
  // «otra factura/proforma», «otro presupuesto/albarán».
  const another =
    targetType === "invoice" || targetType === "proforma" ? "otra" : "otro";

  async function convert(confirmRepeat: boolean) {
    const result = await action.run(() =>
      apiRequest<{ id: string }>(
        `/api/v1/documents/${documentId}/convert`,
        jsonRequest("POST", {
          target_type: targetType,
          ...(confirmRepeat ? { confirm_repeat: true } : {}),
        }),
      ),
    );
    if (result) {
      router.push(`/documents/${result.id}`);
    }
  }

  return (
    <div className="space-y-2">
      {showExisting && existing.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Ya existe {label}:{" "}
          {existing.map((target, index) => (
            <span key={target.id}>
              {index > 0 ? ", " : ""}
              <Link
                className="underline underline-offset-4"
                href={`/documents/${target.id}`}
              >
                {target.full_number ?? "borrador"}
              </Link>
            </span>
          ))}
          .
        </p>
      ) : null}
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
          <span>
            ¿Crear {another} {label} a partir de este documento?
          </span>
          <Button
            type="button"
            size="sm"
            disabled={action.isLoading}
            onClick={() => convert(true)}
          >
            Sí, crear {another}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setConfirming(false)}
          >
            Cancelar
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          disabled={action.isLoading}
          onClick={() =>
            existing.length > 0 ? setConfirming(true) : convert(false)
          }
        >
          {action.isLoading
            ? "Convirtiendo…"
            : existing.length > 0
              ? `Crear ${another} ${label}`
              : `Convertir en ${label}`}
        </Button>
      )}
      {action.error ? (
        <p role="alert" className="max-w-md text-sm text-destructive">
          {action.error}
        </p>
      ) : null}
    </div>
  );
}

function QuoteDecision({
  documentId,
  derivedState,
  onChanged,
}: {
  documentId: string;
  derivedState: string | null;
  onChanged?: () => void;
}) {
  const action = useMutation<{ quote_decision: string }>();

  async function decide(decision: "accepted" | "rejected") {
    const decided = await action.run(() =>
      apiRequest<{ quote_decision: string }>(
        `/api/v1/documents/${documentId}/quote-decision`,
        jsonRequest("POST", { decision }),
      ),
    );
    if (decided) {
      onChanged?.();
    }
  }

  return (
    <div>
      <h3 className="text-sm font-medium">Respuesta del cliente</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          variant={derivedState === "accepted" ? "default" : "outline"}
          disabled={action.isLoading}
          onClick={() => decide("accepted")}
        >
          Aceptado
        </Button>
        <Button
          type="button"
          variant={derivedState === "rejected" ? "default" : "outline"}
          disabled={action.isLoading}
          onClick={() => decide("rejected")}
        >
          Rechazado
        </Button>
      </div>
      {action.error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {action.error}
        </p>
      ) : null}
    </div>
  );
}

function DuplicateAction({ documentId }: { documentId: string }) {
  const { duplicate, isLoading, error } = useDuplicateDocument();

  return (
    <div>
      <Button
        type="button"
        variant="outline"
        disabled={isLoading}
        onClick={() => duplicate(documentId)}
      >
        {isLoading ? "Duplicando…" : "Duplicar como nuevo borrador"}
      </Button>
      {error ? (
        <p role="alert" className="mt-2 max-w-md text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ReceiptAction({
  documentId,
  payment,
}: {
  documentId: string;
  payment: DocumentPayment;
}) {
  const router = useRouter();
  const action = useMutation<{ id: string }>();

  async function handleGenerate() {
    const result = await action.run(() =>
      apiRequest<{ id: string }>(
        `/api/v1/documents/${documentId}/receipt`,
        jsonRequest("POST", { payment_id: payment.id }),
      ),
    );
    if (result) {
      router.push(`/documents/${result.id}`);
    }
  }

  return (
    <div className="flex flex-col gap-1 border-t py-3 first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm text-muted-foreground">
        Cobro del {formattedDate(payment.paid_on)} ·{" "}
        {formatEur(createCents(payment.amount_cents))}
      </span>
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={action.isLoading}
          onClick={handleGenerate}
        >
          {action.isLoading ? "Generando…" : "Generar recibo"}
        </Button>
        {action.error ? (
          <p role="alert" className="mt-1 max-w-xs text-xs text-destructive">
            {action.error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Conversion always resolves to a distinct (draft or issued) invoice, and
 * duplication and receipt generation always create a distinct document, so
 * every action here navigates to that new document instead of refreshing
 * the current one in place.
 */
export function DocumentActions({
  documentId,
  documentType,
  status,
  derivedState,
  linkedTargets,
  issuedDocuments,
  documentLimit,
  payments,
  canDownloadXlsx,
  readOnly = false,
  onChanged,
}: DocumentActionsProps) {
  const isIssued = status === "issued";
  const conversions = linkedTargets.filter(
    (target) => target.kind === "converted" && target.status !== "voided",
  );
  const invoicedBy = linkedTargets.find((target) => target.kind === "invoiced");
  const targets = !readOnly && isIssued ? CONVERSION_TARGETS[documentType] : [];
  const proformaToInvoice =
    documentType === "proforma" &&
    !conversions.some((target) => target.doc_type === "invoice");
  const canDuplicate = !readOnly && documentType !== "receipt";
  const canGenerateReceipts = !readOnly && documentType === "invoice";
  const canDecideQuote = !readOnly && isIssued && documentType === "quote";

  if (
    targets.length === 0 &&
    !canDuplicate &&
    !canGenerateReceipts &&
    conversions.length === 0 &&
    !canDownloadXlsx
  ) {
    return null;
  }

  return (
    <section className="space-y-5 rounded-xl border bg-card p-5 shadow-sm">
      <h2 className="font-semibold">Acciones</h2>

      {documentType === "proforma" && !proformaToInvoice ? (
        <p className="text-sm text-muted-foreground">
          Esta proforma ya se convirtió en factura.{" "}
          <Link
            className="underline-offset-4 hover:underline"
            href={`/documents/${
              conversions.find((target) => target.doc_type === "invoice")?.id
            }`}
          >
            Ver factura
          </Link>
        </p>
      ) : null}

      {invoicedBy ? (
        <p className="text-sm text-muted-foreground">
          Albarán facturado en{" "}
          <Link
            className="underline-offset-4 hover:underline"
            href={`/documents/${invoicedBy.id}`}
          >
            {invoicedBy.full_number ?? "un borrador de factura"}
          </Link>
          .
        </p>
      ) : null}

      {canDecideQuote ? (
        <QuoteDecision
          documentId={documentId}
          derivedState={derivedState}
          onChanged={onChanged}
        />
      ) : null}

      {targets.includes("invoice") &&
      proformaToInvoice &&
      documentType === "proforma" ? (
        <ConvertAction
          documentId={documentId}
          issuedDocuments={issuedDocuments}
          documentLimit={documentLimit}
        />
      ) : null}

      {targets.length > 0 ? (
        <div className="space-y-3">
          {targets
            .filter(
              (target) =>
                !(
                  target === "invoice" &&
                  documentType === "proforma" &&
                  proformaToInvoice
                ) && !(target === "invoice" && invoicedBy),
            )
            .map((target) => (
              <ConvertToType
                key={target}
                documentId={documentId}
                targetType={target}
                existing={conversions.filter(
                  (conversion) => conversion.doc_type === target,
                )}
                showExisting={documentType !== "proforma"}
              />
            ))}
        </div>
      ) : conversions.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Convertido en{" "}
          {conversions.map((target, index) => (
            <span key={target.id}>
              {index > 0 ? ", " : ""}
              <Link
                className="underline underline-offset-4"
                href={`/documents/${target.id}`}
              >
                {documentTypeLabel(target.doc_type)}{" "}
                {target.full_number ?? "borrador"}
              </Link>
            </span>
          ))}
          .
        </p>
      ) : null}

      {canDuplicate ? <DuplicateAction documentId={documentId} /> : null}

      {canDownloadXlsx ? (
        <Button asChild variant="outline">
          <a href={`/api/v1/documents/${documentId}/xlsx`} download>
            Descargar Excel
          </a>
        </Button>
      ) : null}

      {canGenerateReceipts && payments.length > 0 ? (
        <div>
          <h3 className="text-sm font-medium">Recibos</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Cada cobro tiene como mucho un recibo. Generarlo de nuevo abre el ya
            existente sin crear otro.
          </p>
          <div className="mt-2">
            {payments.map((payment) => (
              <ReceiptAction
                key={payment.id}
                documentId={documentId}
                payment={payment}
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

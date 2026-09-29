"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import type { DocumentPayment } from "@/components/documents/payments-panel";
import { useAsyncAction } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { apiRequest, jsonRequest } from "@/lib/api/client";
import { createCents, formatEur } from "@/lib/money";

interface DocumentActionsProps {
  documentId: string;
  documentType: "invoice" | "proforma" | "receipt";
  convertedToId: string | null;
  issuedDocuments: number;
  documentLimit: number;
  payments: DocumentPayment[];
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
  const action = useAsyncAction<{ id: string }>();
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
          Has alcanzado el límite de {documentLimit} emisiones de este mes.
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

function DuplicateAction({ documentId }: { documentId: string }) {
  const router = useRouter();
  const action = useAsyncAction<{ id: string }>();

  async function handleDuplicate() {
    const result = await action.run(() =>
      apiRequest<{ id: string }>(`/api/v1/documents/${documentId}/duplicate`, {
        method: "POST",
      }),
    );
    if (result) {
      router.push(`/documents/${result.id}`);
    }
  }

  return (
    <div>
      <Button
        type="button"
        variant="outline"
        disabled={action.isLoading}
        onClick={handleDuplicate}
      >
        {action.isLoading ? "Duplicando…" : "Duplicar como nuevo borrador"}
      </Button>
      {action.error ? (
        <p role="alert" className="mt-2 max-w-md text-sm text-destructive">
          {action.error}
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
  const action = useAsyncAction<{ id: string }>();

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
  convertedToId,
  issuedDocuments,
  documentLimit,
  payments,
}: DocumentActionsProps) {
  const canConvert = documentType === "proforma" && !convertedToId;
  const canDuplicate = documentType !== "receipt";
  const canGenerateReceipts = documentType === "invoice";

  if (!canConvert && !canDuplicate && !canGenerateReceipts && !convertedToId) {
    return null;
  }

  return (
    <section className="space-y-5 rounded-xl border bg-card p-5 shadow-sm">
      <h2 className="font-semibold">Acciones</h2>

      {convertedToId ? (
        <p className="text-sm text-muted-foreground">
          Esta proforma ya se convirtió en factura.{" "}
          <Link
            className="underline-offset-4 hover:underline"
            href={`/documents/${convertedToId}`}
          >
            Ver factura
          </Link>
        </p>
      ) : null}

      {canConvert ? (
        <ConvertAction
          documentId={documentId}
          issuedDocuments={issuedDocuments}
          documentLimit={documentLimit}
        />
      ) : null}

      {canDuplicate ? <DuplicateAction documentId={documentId} /> : null}

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

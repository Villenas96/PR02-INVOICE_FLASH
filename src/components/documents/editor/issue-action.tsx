"use client";

import { useAsyncAction } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api/client";

interface IssueActionProps {
  documentId: string;
  isCompanyReady: boolean;
  issuedDocuments: number;
  documentLimit: number;
  onIssued: () => Promise<void>;
}

export function IssueAction({
  documentId,
  isCompanyReady,
  issuedDocuments,
  documentLimit,
  onIssued,
}: IssueActionProps) {
  const action = useAsyncAction<unknown>();
  const limitReached = issuedDocuments >= documentLimit;

  async function handleIssue() {
    const issued = await action.run(() =>
      apiRequest<unknown>(`/api/v1/documents/${documentId}/issue`, {
        method: "POST",
      }),
    );
    if (issued !== undefined) {
      await onIssued();
    }
  }

  return (
    <div>
      <Button
        type="button"
        disabled={action.isLoading || limitReached || !isCompanyReady}
        onClick={handleIssue}
      >
        {action.isLoading ? "Emitiendo…" : "Emitir factura"}
      </Button>
      {!isCompanyReady ? (
        <p className="mt-2 max-w-md text-sm text-destructive">
          Completa nombre fiscal, NIF y dirección antes de emitir.
        </p>
      ) : limitReached ? (
        <p className="mt-2 max-w-md text-sm text-destructive">
          Has alcanzado el límite de {documentLimit} emisiones de este mes. El
          borrador permanece disponible.
        </p>
      ) : issuedDocuments / documentLimit >= 0.8 ? (
        <p className="mt-2 max-w-md text-sm text-amber-700">
          Te quedan {documentLimit - issuedDocuments} emisiones este mes.
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

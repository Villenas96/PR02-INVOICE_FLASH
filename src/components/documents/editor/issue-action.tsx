"use client";

import Link from "next/link";
import { useState } from "react";

import { UpsellNotice } from "@/components/plan/feature-upsell";
import { useMutation } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiRequest, type Upsell, upsellFromError } from "@/lib/api/client";
import { documentTypePlural } from "@/lib/documents/labels";

interface IssueActionProps {
  documentId: string;
  documentType?: "invoice" | "proforma";
  isCompanyReady: boolean;
  issuedDocuments: number;
  documentLimit: number;
  onIssued: () => Promise<void>;
}

/**
 * Issues a draft. Reaching the quota never shows an error: the draft is
 * kept without a number and an upgrade dialog links to the plans page with
 * `resume`, so the issue completes right after paying (FR-009, SC-002).
 */
export function IssueAction({
  documentId,
  documentType = "invoice",
  isCompanyReady,
  issuedDocuments,
  documentLimit,
  onIssued,
}: IssueActionProps) {
  const action = useMutation<unknown>();
  const [upsell, setUpsell] = useState<Upsell | null>(null);
  const limitReached = issuedDocuments >= documentLimit;
  const label = documentType === "proforma" ? "proforma" : "factura";
  const plural = documentTypePlural(documentType);
  const upgradeUrl = `/billing?resume=${documentId}`;

  async function handleIssue() {
    let blocked: Upsell | null = null;
    const issued = await action.run(async () => {
      try {
        return await apiRequest<unknown>(
          `/api/v1/documents/${documentId}/issue`,
          { method: "POST" },
        );
      } catch (error) {
        blocked = upsellFromError(error);
        throw error;
      }
    });
    if (blocked) {
      setUpsell(blocked);
      return;
    }
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
        {action.isLoading ? "Emitiendo…" : `Emitir ${label}`}
      </Button>
      {!isCompanyReady ? (
        <p className="mt-2 max-w-md text-sm text-destructive">
          Completa nombre fiscal, NIF y dirección antes de emitir.
        </p>
      ) : limitReached ? (
        <p className="mt-2 max-w-md text-sm text-destructive">
          Has alcanzado el límite de {documentLimit} {plural} de este mes. El
          borrador permanece disponible.{" "}
          <Link className="font-medium underline" href={upgradeUrl}>
            Mejorar plan
          </Link>
        </p>
      ) : issuedDocuments / documentLimit >= 0.8 ? (
        <p className="mt-2 max-w-md text-sm text-amber-700">
          Te quedan {documentLimit - issuedDocuments} {plural} este mes.
        </p>
      ) : null}
      {action.error && !upsell ? (
        <p role="alert" className="mt-2 max-w-md text-sm text-destructive">
          {action.error}
        </p>
      ) : null}
      <Dialog
        open={upsell !== null}
        onOpenChange={(open) => (open ? undefined : setUpsell(null))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Has llegado al límite de tu plan</DialogTitle>
            <DialogDescription>
              No se ha usado ningún número: el borrador sigue guardado.
            </DialogDescription>
          </DialogHeader>
          {upsell ? (
            <UpsellNotice upsell={upsell} upgradeUrl={upgradeUrl} />
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setUpsell(null)}
            >
              Seguir con el borrador
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

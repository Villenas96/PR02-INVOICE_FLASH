"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

type PdfStatus = "failed" | "pending" | "ready";
type DownloadState = "failed" | "processing" | "ready";

async function errorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: { message?: string };
    };
    return (
      payload.error?.message ?? "No se ha podido preparar la descarga del PDF."
    );
  } catch {
    return "No se ha podido preparar la descarga del PDF.";
  }
}

export function PdfDownload({
  documentId,
  fullNumber,
  pdfStatus,
}: {
  documentId: string;
  fullNumber: string;
  pdfStatus: PdfStatus;
}) {
  const [state, setState] = useState<DownloadState>(
    pdfStatus === "ready"
      ? "ready"
      : pdfStatus === "failed"
        ? "failed"
        : "processing",
  );
  const [objectUrl, setObjectUrl] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (pdfStatus !== "pending") {
      setState(pdfStatus === "ready" ? "ready" : "failed");
      return;
    }

    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let currentObjectUrl: string | undefined;

    async function poll() {
      try {
        const response = await fetch(`/api/v1/documents/${documentId}/pdf`, {
          cache: "no-store",
        });
        if (cancelled) {
          return;
        }
        if (response.status === 202) {
          const retrySeconds = Number(response.headers.get("retry-after"));
          timeout = setTimeout(
            poll,
            Number.isFinite(retrySeconds) && retrySeconds > 0
              ? retrySeconds * 1000
              : 2000,
          );
          return;
        }
        if (response.ok) {
          const blob = await response.blob();
          if (cancelled) {
            return;
          }
          currentObjectUrl = URL.createObjectURL(blob);
          setObjectUrl(currentObjectUrl);
          setState("ready");
          return;
        }

        setError(await errorMessage(response));
        setState("failed");
      } catch {
        if (!cancelled) {
          timeout = setTimeout(poll, 2000);
        }
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      if (currentObjectUrl) {
        URL.revokeObjectURL(currentObjectUrl);
      }
    };
  }, [documentId, pdfStatus]);

  if (state === "processing") {
    return (
      <output className="inline-flex h-8 items-center rounded-lg bg-muted px-3 text-sm">
        Generando PDF…
      </output>
    );
  }
  if (state === "failed") {
    return (
      <p role="alert" className="max-w-md text-sm text-destructive">
        {error ??
          "No se ha podido generar el PDF. Reintenta desde el documento."}
      </p>
    );
  }

  return (
    <Button asChild variant="outline">
      <a
        href={objectUrl ?? `/api/v1/documents/${documentId}/pdf`}
        download={`factura-${fullNumber}.pdf`}
      >
        Descargar PDF
      </a>
    </Button>
  );
}

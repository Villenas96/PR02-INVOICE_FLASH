import { notFound } from "next/navigation";

import { PrintableDocument } from "@/components/documents/printable-document";
import { type DocumentDetail, getDocumentDetail } from "@/services/documents";
import { printableFromDocument } from "@/services/printable";
import { resolveSharedDocument } from "@/services/shared-document";

/**
 * Public view of a shared document: the same content as the PDF and the
 * printable view (logos, units, payment block, observations), built only
 * from the frozen snapshots.
 */
export default async function SharedDocumentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const shared = await resolveSharedDocument(token);
  const document = shared
    ? await getDocumentDetail<DocumentDetail>({
        companyId: shared.companyId,
        documentId: shared.documentId,
      }).catch(() => null)
    : null;
  if (!shared || !document) {
    notFound();
  }

  const base = `/d/${encodeURIComponent(token)}`;
  const data = printableFromDocument(document, (key) =>
    key === shared.issuerLogoKey
      ? `${base}/logo/issuer`
      : `${base}/logo/client`,
  );

  return (
    <div className="min-h-screen bg-muted/30">
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold tracking-tight">Invoice Flash</p>
          <a
            className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
            href={`${base}/pdf`}
          >
            Descargar PDF
          </a>
        </header>

        {document.status === "voided" ? (
          <output className="block rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-center text-sm font-medium text-[color-mix(in_oklch,var(--destructive),var(--foreground)_35%)]">
            Este documento ha sido anulado.
          </output>
        ) : null}

        <div className="rounded-xl border bg-card shadow-sm">
          <PrintableDocument data={data} />
        </div>
      </main>
    </div>
  );
}

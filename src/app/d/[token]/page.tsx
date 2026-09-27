import { and, asc, eq, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";

import { createDatabase } from "@/db";
import { documentLines, documents } from "@/db/schema/document";
import { shareLinks } from "@/db/schema/share-link";
import { createCents, formatEur } from "@/lib/money";

interface IssuerSnapshot {
  legalName: string;
  taxId: string;
  address: string;
  email: string;
  phone: string | null;
}

interface ClientSnapshot {
  name: string;
  taxId: string | null;
  address: string | null;
}

async function loadSharedDocument(token: string) {
  const database = createDatabase();
  const rows = await database
    .select({ document: documents, line: documentLines })
    .from(shareLinks)
    .innerJoin(documents, eq(documents.id, shareLinks.documentId))
    .leftJoin(documentLines, eq(documentLines.documentId, documents.id))
    .where(and(eq(shareLinks.token, token), isNull(shareLinks.disabledAt)))
    .orderBy(asc(documentLines.position));

  const document = rows[0]?.document;
  if (!document || document.deletedAt) {
    return null;
  }

  return {
    document,
    lines: rows.flatMap((row) => (row.line ? [row.line] : [])),
  };
}

function formattedDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

const typeLabels: Record<string, string> = {
  invoice: "Factura",
  proforma: "Proforma",
  receipt: "Recibo",
};

export default async function SharedDocumentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const shared = await loadSharedDocument(token);

  if (!shared) {
    notFound();
  }

  const { document, lines } = shared;
  const issuer = document.issuerSnapshot as IssuerSnapshot | null;
  const client = document.clientSnapshot as ClientSnapshot | null;
  const taxBreakdown = document.taxBreakdown as Array<{
    rate: string;
    baseCents: number;
    taxCents: number;
  }>;

  return (
    <div className="min-h-screen bg-muted/30">
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <header className="text-center">
          <p className="text-sm font-semibold tracking-tight">Invoice Flash</p>
        </header>

        {document.status === "voided" ? (
          <output className="block rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-center text-sm font-medium text-[color-mix(in_oklch,var(--destructive),var(--foreground)_35%)]">
            Este documento ha sido anulado.
          </output>
        ) : null}

        <section className="rounded-xl border bg-card p-5 shadow-sm sm:p-6">
          <p className="text-sm text-muted-foreground">
            {typeLabels[document.documentType] ?? document.documentType}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            {document.fullNumber ?? "Documento"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Emisión {formattedDate(document.issueDate)}
            {document.dueDate
              ? ` · vencimiento ${formattedDate(document.dueDate)}`
              : ""}
          </p>
          <a
            className="mt-4 inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
            href={`/d/${token}/pdf`}
          >
            Descargar PDF
          </a>
        </section>

        {issuer && client ? (
          <section className="grid gap-6 rounded-xl border bg-card p-5 shadow-sm sm:grid-cols-2 sm:p-6">
            <div>
              <h2 className="font-semibold">Emisor</h2>
              <address className="mt-3 space-y-1 text-sm not-italic text-muted-foreground">
                <p className="font-medium text-foreground">
                  {issuer.legalName}
                </p>
                <p>{issuer.taxId}</p>
                <p>{issuer.address}</p>
              </address>
            </div>
            <div>
              <h2 className="font-semibold">Cliente</h2>
              <address className="mt-3 space-y-1 text-sm not-italic text-muted-foreground">
                <p className="font-medium text-foreground">{client.name}</p>
                <p>{client.taxId ?? "Sin NIF"}</p>
                <p>{client.address ?? "Sin dirección"}</p>
              </address>
            </div>
          </section>
        ) : null}

        <section className="overflow-x-auto rounded-xl border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3 font-medium">Descripción</th>
                <th className="p-3 font-medium">Cantidad</th>
                <th className="p-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-b last:border-0">
                  <td className="p-3">{line.description}</td>
                  <td className="p-3">
                    {Number(line.quantity).toLocaleString("es-ES")}
                  </td>
                  <td className="p-3 text-right font-medium">
                    {formatEur(createCents(line.lineTotalCents))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="ml-auto w-full max-w-sm space-y-2 border-t p-5 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Base imponible</span>
              <span>{formatEur(createCents(document.subtotalCents))}</span>
            </div>
            {taxBreakdown?.map((tax) => (
              <div key={tax.rate} className="flex justify-between gap-4">
                <span className="text-muted-foreground">
                  IVA {Number(tax.rate).toLocaleString("es-ES")} %
                </span>
                <span>{formatEur(createCents(tax.taxCents))}</span>
              </div>
            ))}
            {document.retentionCents > 0 ? (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Retención</span>
                <span>-{formatEur(createCents(document.retentionCents))}</span>
              </div>
            ) : null}
            <div className="flex justify-between gap-4 border-t pt-3 text-base font-semibold">
              <span>Total</span>
              <span>{formatEur(createCents(document.totalCents))}</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

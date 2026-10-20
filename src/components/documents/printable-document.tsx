import { Fragment } from "react";

import { DOCUMENT_TYPE_LABELS } from "@/lib/documents/labels";
import { createCents, formatEur } from "@/lib/money";
import type { DocumentType } from "@/lib/plan";

export interface PrintableParty {
  name: string;
  taxId: string | null;
  address: string | null;
  /** Issuer only: the client's email is never printed (FR-006). */
  email?: string | null;
  logoUrl?: string | null;
}

export interface PrintableLine {
  id: string;
  description: string;
  quantity: string;
  unit: string | null;
  unitPriceCents: number;
  taxName: string;
  taxRate: string;
  lineTotalCents: number;
  /** Delivery note group when an invoice bills several (US9-AC4). */
  sectionLabel?: string | null;
}

export interface PrintablePayment {
  kind: string;
  label: string;
  holder?: string;
  iban?: string;
  bic?: string;
  phone?: string;
  email_or_url?: string;
  instructions?: string;
}

export interface PrintableDocumentData {
  documentType: DocumentType;
  fullNumber: string | null;
  status: "draft" | "issued" | "voided";
  issueDate: string;
  dueDate: string | null;
  validUntil?: string | null;
  issuer: PrintableParty | null;
  client: PrintableParty | null;
  lines: PrintableLine[];
  subtotalCents: number;
  taxBreakdown: Array<{
    name?: string;
    rate: string;
    taxCents: number;
  }>;
  retentionRate: string;
  retentionCents: number;
  totalCents: number;
  notes: string | null;
  payment: PrintablePayment | null;
}

function formattedDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

function formatQuantity(value: string): string {
  return Number(value).toLocaleString("es-ES", { maximumFractionDigits: 3 });
}

function formatIbanGroups(iban: string): string {
  return iban.replace(/(.{4})(?=.)/g, "$1 ");
}

function PartyBlock({
  heading,
  party,
}: {
  heading: string;
  party: PrintableParty;
}) {
  return (
    <div className="space-y-2">
      {party.logoUrl ? (
        // biome-ignore lint/performance/noImgElement: private R2 logo served by an authenticated route; next/image would proxy it publicly.
        <img
          src={party.logoUrl}
          alt=""
          className="max-h-16 max-w-40 object-contain"
        />
      ) : null}
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {heading}
      </h2>
      <address className="space-y-0.5 text-sm not-italic">
        <p className="font-medium">{party.name}</p>
        {party.taxId ? <p>NIF: {party.taxId}</p> : null}
        {party.address ? (
          <p className="whitespace-pre-line">{party.address}</p>
        ) : null}
        {party.email ? <p>{party.email}</p> : null}
      </address>
    </div>
  );
}

/**
 * Same content as the PDF and the public view: header with logos, parties,
 * lines with units, tax breakdown by name, payment block and observations.
 */
export function PrintableDocument({ data }: { data: PrintableDocumentData }) {
  const title = DOCUMENT_TYPE_LABELS[data.documentType].singular;
  const notes = data.notes?.trim();

  return (
    <article className="mx-auto max-w-3xl space-y-8 bg-background p-6 text-foreground print:max-w-none print:p-0">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {data.fullNumber ?? "Borrador"}
          </h1>
          {data.status === "voided" ? (
            <p className="mt-1 font-medium text-destructive">Anulado</p>
          ) : null}
          {data.documentType === "proforma" ||
          data.documentType === "quote" ||
          data.documentType === "delivery_note" ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Sin validez fiscal de factura.
            </p>
          ) : null}
        </div>
        <dl className="text-right text-sm">
          <dt className="text-muted-foreground">Fecha de emisión</dt>
          <dd>{formattedDate(data.issueDate)}</dd>
          {data.documentType === "quote" && data.validUntil ? (
            <>
              <dt className="mt-1 text-muted-foreground">Válido hasta</dt>
              <dd>{formattedDate(data.validUntil)}</dd>
            </>
          ) : data.dueDate ? (
            <>
              <dt className="mt-1 text-muted-foreground">Vencimiento</dt>
              <dd>{formattedDate(data.dueDate)}</dd>
            </>
          ) : null}
        </dl>
      </header>

      <section className="grid gap-6 sm:grid-cols-2 print:grid-cols-2">
        {data.issuer ? (
          <PartyBlock heading="Emisor" party={data.issuer} />
        ) : null}
        {data.client ? (
          <PartyBlock heading="Cliente" party={data.client} />
        ) : null}
      </section>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 font-medium">Concepto</th>
            <th className="py-2 text-right font-medium">Cantidad</th>
            <th className="py-2 text-right font-medium">Precio</th>
            <th className="py-2 text-right font-medium">Impuesto</th>
            <th className="py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((line, index) => (
            <Fragment key={line.id}>
              {line.sectionLabel &&
              line.sectionLabel !== data.lines[index - 1]?.sectionLabel ? (
                <tr className="border-b bg-muted/50">
                  <th
                    scope="rowgroup"
                    colSpan={5}
                    className="py-2 pl-1 text-left font-semibold"
                  >
                    {line.sectionLabel}
                  </th>
                </tr>
              ) : null}
              <tr className="border-b last:border-0">
                <td className="py-2 pr-2">{line.description}</td>
                <td className="py-2 text-right">
                  {formatQuantity(line.quantity)}
                  {line.unit ? ` ${line.unit}` : ""}
                </td>
                <td className="py-2 text-right">
                  {formatEur(createCents(line.unitPriceCents))}
                </td>
                <td className="py-2 text-right">
                  {line.taxName} {Number(line.taxRate).toLocaleString("es-ES")}{" "}
                  %
                </td>
                <td className="py-2 text-right font-medium">
                  {formatEur(createCents(line.lineTotalCents))}
                </td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>

      <section className="ml-auto w-full max-w-xs space-y-1 text-sm">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Base imponible</span>
          <span>{formatEur(createCents(data.subtotalCents))}</span>
        </div>
        {data.taxBreakdown.map((tax) => (
          <div
            key={`${tax.name ?? "IVA"}-${tax.rate}`}
            className="flex justify-between gap-4"
          >
            <span className="text-muted-foreground">
              {tax.name ?? "IVA"} {Number(tax.rate).toLocaleString("es-ES")} %
            </span>
            <span>{formatEur(createCents(tax.taxCents))}</span>
          </div>
        ))}
        {data.retentionCents > 0 ? (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">
              Retención IRPF (
              {Number(data.retentionRate).toLocaleString("es-ES")} %)
            </span>
            <span>-{formatEur(createCents(data.retentionCents))}</span>
          </div>
        ) : null}
        <div className="flex justify-between gap-4 border-t pt-2 text-base font-semibold">
          <span>Total</span>
          <span>{formatEur(createCents(data.totalCents))}</span>
        </div>
      </section>

      {data.documentType === "invoice" ? (
        <section
          aria-labelledby="payment-title"
          className="space-y-1 rounded-lg border p-4 text-sm"
        >
          <h2 id="payment-title" className="font-semibold">
            Pago
          </h2>
          <p>
            Importe a pagar: {formatEur(createCents(data.totalCents))}
            {data.dueDate ? ` antes del ${formattedDate(data.dueDate)}` : ""}
          </p>
          {data.payment ? (
            <>
              <p>{data.payment.label}</p>
              {data.payment.holder ? (
                <p>Titular: {data.payment.holder}</p>
              ) : null}
              {data.payment.iban ? (
                <p>IBAN: {formatIbanGroups(data.payment.iban)}</p>
              ) : null}
              {data.payment.bic ? <p>BIC: {data.payment.bic}</p> : null}
              {data.payment.phone ? <p>Bizum: {data.payment.phone}</p> : null}
              {data.payment.email_or_url ? (
                <p>PayPal: {data.payment.email_or_url}</p>
              ) : null}
              {data.payment.instructions ? (
                <p className="whitespace-pre-line">
                  {data.payment.instructions}
                </p>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {notes ? (
        <section
          aria-labelledby="observations-title"
          className="rounded-lg border p-4 text-sm"
        >
          <h2 id="observations-title" className="font-semibold">
            Observaciones
          </h2>
          <p className="mt-1 whitespace-pre-line">{notes}</p>
        </section>
      ) : null}
    </article>
  );
}

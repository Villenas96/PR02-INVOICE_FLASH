import {
  paragraph,
  type RenderedEmail,
  renderEmailLayout,
} from "@/services/email/templates/layout";

export type DocumentEmailTemplate = RenderedEmail;

const TYPE_LABELS: Record<
  "invoice" | "proforma" | "receipt",
  { noun: string; article: "la" | "el" }
> = {
  invoice: { noun: "factura", article: "la" },
  proforma: { noun: "proforma", article: "la" },
  receipt: { noun: "recibo", article: "el" },
};

export function renderDocumentEmailTemplate(input: {
  documentType: "invoice" | "proforma" | "receipt";
  fullNumber: string;
  totalFormatted: string;
  issuerLegalName: string;
  shareUrl: string;
  customMessage: string | null;
}): DocumentEmailTemplate {
  const { noun, article } = TYPE_LABELS[input.documentType];
  const introduction = `${input.issuerLegalName} te ha enviado ${article} ${noun} ${input.fullNumber} por ${input.totalFormatted}.`;
  const customBlock = input.customMessage ? `\n\n${input.customMessage}` : "";

  return {
    subject: `${input.issuerLegalName}: ${noun} ${input.fullNumber}`,
    text: `${introduction}${customBlock}\n\nVer documento: ${input.shareUrl}`,
    html: renderEmailLayout({
      title: input.fullNumber,
      bodyHtml: [
        paragraph(introduction),
        ...(input.customMessage ? [paragraph(input.customMessage)] : []),
      ].join("\n        "),
      action: { label: "Ver documento", url: input.shareUrl },
      footnote: `Para cualquier duda sobre este documento, responde a este correo y le llegará a ${input.issuerLegalName}.`,
    }),
  };
}

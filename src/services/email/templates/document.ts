export interface DocumentEmailTemplate {
  subject: string;
  text: string;
  html: string;
}

const TYPE_LABELS: Record<"invoice" | "proforma" | "receipt", string> = {
  invoice: "factura",
  proforma: "proforma",
  receipt: "recibo",
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderDocumentEmailTemplate(input: {
  documentType: "invoice" | "proforma" | "receipt";
  fullNumber: string;
  totalFormatted: string;
  issuerLegalName: string;
  shareUrl: string;
  customMessage: string | null;
}): DocumentEmailTemplate {
  const typeLabel = TYPE_LABELS[input.documentType];
  const safeShareUrl = escapeHtml(input.shareUrl);
  const introduction = `${input.issuerLegalName} te ha enviado ${typeLabel === "factura" ? "la" : "el"} ${typeLabel} ${input.fullNumber} por ${input.totalFormatted}.`;
  const customBlock = input.customMessage ? `\n\n${input.customMessage}` : "";
  const customHtmlBlock = input.customMessage
    ? `<p style="margin:0 0 24px;line-height:1.6;white-space:pre-wrap">${escapeHtml(input.customMessage)}</p>`
    : "";

  return {
    subject: `${input.issuerLegalName}: ${typeLabel} ${input.fullNumber}`,
    text: `${introduction}${customBlock}\n\nVer documento: ${input.shareUrl}`,
    html: `<!doctype html>
<html lang="es">
  <body style="margin:0;background:#f4f4f5;color:#18181b;font-family:Arial,sans-serif">
    <main style="max-width:560px;margin:0 auto;padding:32px 16px">
      <section style="background:#fff;border:1px solid #e4e4e7;border-radius:12px;padding:32px">
        <p style="margin:0 0 20px;font-size:14px;font-weight:700">Invoice Flash</p>
        <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25">${escapeHtml(input.fullNumber)}</h1>
        <p style="margin:0 0 24px;line-height:1.6">${escapeHtml(introduction)}</p>
        ${customHtmlBlock}
        <p style="margin:0 0 24px">
          <a href="${safeShareUrl}" style="display:inline-block;border-radius:8px;background:#18181b;color:#fff;padding:12px 18px;text-decoration:none;font-weight:700">Ver documento</a>
        </p>
      </section>
    </main>
  </body>
</html>`,
  };
}

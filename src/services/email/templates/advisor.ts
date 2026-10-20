import {
  escapeHtml,
  paragraph,
  type RenderedEmail,
  renderEmailLayout,
} from "@/services/email/templates/layout";

export const ADVISOR_TEMPLATES = ["advisor_invite", "advisor_export"] as const;
export type AdvisorTemplate = (typeof ADVISOR_TEMPLATES)[number];

const dateFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Madrid",
});

/** Invitation to read-only access (FR-050); expires in 7 days. */
export function renderAdvisorInvite(input: {
  companyName: string;
  acceptUrl: string;
  expiresAt: Date;
}): RenderedEmail {
  const text = `${input.companyName} te invita a consultar sus documentos, clientes y cobros en Factum con acceso de solo lectura. Podrás descargar PDF y exportar sus datos, pero no modificar nada. La invitación caduca el ${dateFormatter.format(input.expiresAt)}.`;
  return {
    subject: `${input.companyName} te invita como gestoría en Factum`,
    text: `${text}\n\nAceptar invitación: ${input.acceptUrl}`,
    html: renderEmailLayout({
      title: "Invitación de acceso para tu gestoría",
      bodyHtml: paragraph(text),
      action: { label: "Aceptar invitación", url: input.acceptUrl },
      footnote:
        "Si no esperabas esta invitación, ignora este correo: sin aceptarla no se concede ningún acceso.",
    }),
  };
}

/**
 * Period package for the advisor (FR-032): only the expiring link, never
 * the file or any amount in the email body.
 */
export function renderAdvisorExport(input: {
  companyName: string;
  periodLabel: string | null;
  downloadUrl: string;
  expiresAt: Date;
}): RenderedEmail {
  const period = input.periodLabel ? ` (${input.periodLabel})` : "";
  const text = `${input.companyName} te envía su documentación de facturación${period}. El enlace de descarga es válido hasta el ${dateFormatter.format(input.expiresAt)}.`;
  return {
    subject: `Documentación de ${input.companyName}${period}`,
    text: `${text}\n\nDescargar: ${input.downloadUrl}`,
    html: renderEmailLayout({
      title: "Documentación para tu gestoría",
      bodyHtml: `${paragraph(text)}<p style="margin:0 0 24px;color:#71717a;font-size:13px">${escapeHtml("Enviado desde Factum.")}</p>`,
      action: { label: "Descargar", url: input.downloadUrl },
    }),
  };
}

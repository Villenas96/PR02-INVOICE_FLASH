import type { AuthEmailPurpose } from "@/lib/auth";
import {
  EMAIL_BRAND,
  paragraph,
  type RenderedEmail,
  renderEmailLayout,
} from "@/services/email/templates/layout";

export type AuthEmailTemplate = RenderedEmail;

const IGNORE_NOTICE =
  "Si no has solicitado esta acción, puedes ignorar este mensaje.";

function renderMessage({
  actionLabel,
  actionUrl,
  introduction,
  title,
}: {
  actionLabel: string;
  actionUrl: string;
  introduction: string;
  title: string;
}): Pick<AuthEmailTemplate, "html" | "text"> {
  return {
    text: `${introduction}\n\n${actionLabel}: ${actionUrl}\n\n${IGNORE_NOTICE}`,
    html: renderEmailLayout({
      title,
      bodyHtml: paragraph(introduction),
      action: { label: actionLabel, url: actionUrl },
      footnote: IGNORE_NOTICE,
    }),
  };
}

export function renderAuthEmailTemplate(
  purpose: AuthEmailPurpose,
  actionUrl: string,
): AuthEmailTemplate {
  if (purpose === "verify_email") {
    return {
      subject: `Verifica tu correo en ${EMAIL_BRAND}`,
      ...renderMessage({
        actionLabel: "Verificar mi correo",
        actionUrl,
        introduction: `Confirma tu dirección de correo para activar tu cuenta y empezar a usar ${EMAIL_BRAND}.`,
        title: "Verifica tu correo",
      }),
    };
  }

  return {
    subject: `Recupera tu contraseña de ${EMAIL_BRAND}`,
    ...renderMessage({
      actionLabel: "Elegir una nueva contraseña",
      actionUrl,
      introduction:
        "Hemos recibido una solicitud para cambiar la contraseña de tu cuenta.",
      title: "Recupera tu contraseña",
    }),
  };
}

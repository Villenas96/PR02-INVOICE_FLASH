import type { AuthEmailPurpose } from "@/lib/auth";

export interface AuthEmailTemplate {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

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
  const safeActionUrl = escapeHtml(actionUrl);

  return {
    text: `${introduction}\n\n${actionLabel}: ${actionUrl}\n\nSi no has solicitado esta acción, puedes ignorar este mensaje.`,
    html: `<!doctype html>
<html lang="es">
  <body style="margin:0;background:#f4f4f5;color:#18181b;font-family:Arial,sans-serif">
    <main style="max-width:560px;margin:0 auto;padding:32px 16px">
      <section style="background:#fff;border:1px solid #e4e4e7;border-radius:12px;padding:32px">
        <p style="margin:0 0 20px;font-size:14px;font-weight:700">Invoice Flash</p>
        <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25">${title}</h1>
        <p style="margin:0 0 24px;line-height:1.6">${introduction}</p>
        <p style="margin:0 0 24px">
          <a href="${safeActionUrl}" style="display:inline-block;border-radius:8px;background:#18181b;color:#fff;padding:12px 18px;text-decoration:none;font-weight:700">${actionLabel}</a>
        </p>
        <p style="margin:0;color:#71717a;font-size:13px;line-height:1.5">Si no has solicitado esta acción, puedes ignorar este mensaje.</p>
      </section>
    </main>
  </body>
</html>`,
  };
}

export function renderAuthEmailTemplate(
  purpose: AuthEmailPurpose,
  actionUrl: string,
): AuthEmailTemplate {
  if (purpose === "verify_email") {
    return {
      subject: "Verifica tu correo en Invoice Flash",
      ...renderMessage({
        actionLabel: "Verificar mi correo",
        actionUrl,
        introduction:
          "Confirma tu dirección de correo para activar tu cuenta y empezar a usar Invoice Flash.",
        title: "Verifica tu correo",
      }),
    };
  }

  return {
    subject: "Recupera tu contraseña de Invoice Flash",
    ...renderMessage({
      actionLabel: "Elegir una nueva contraseña",
      actionUrl,
      introduction:
        "Hemos recibido una solicitud para cambiar la contraseña de tu cuenta.",
      title: "Recupera tu contraseña",
    }),
  };
}

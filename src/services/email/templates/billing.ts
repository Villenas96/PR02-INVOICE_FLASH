import {
  paragraph,
  type RenderedEmail,
  renderEmailLayout,
} from "@/services/email/templates/layout";

export const BILLING_NOTICE_TEMPLATES = [
  "billing_payment_failed",
  "billing_grace_ending",
  "billing_downgraded",
  "billing_plan_activated",
] as const;
export type BillingNoticeTemplate = (typeof BILLING_NOTICE_TEMPLATES)[number];

export interface BillingNoticeInput {
  planLabel: string;
  graceUntil: Date | null;
  billingUrl: string;
}

const dateFormatter = new Intl.DateTimeFormat("es-ES", {
  timeZone: "Europe/Madrid",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function graceDate(input: BillingNoticeInput): string {
  return input.graceUntil
    ? dateFormatter.format(input.graceUntil)
    : "los próximos días";
}

/** Subscription notices sent to the account owner (FR-011, T045). */
export function renderBillingNotice(
  template: BillingNoticeTemplate,
  input: BillingNoticeInput,
): RenderedEmail {
  const action = { label: "Gestionar suscripción", url: input.billingUrl };

  switch (template) {
    case "billing_payment_failed": {
      const text = `No hemos podido cobrar la renovación de tu plan ${input.planLabel}. Tus funciones siguen activas hasta el ${graceDate(input)} mientras reintentamos el cobro. Actualiza tu medio de pago para no perderlas.`;
      return {
        subject: "No hemos podido cobrar tu suscripción",
        text: `${text}\n\n${action.label}: ${action.url}`,
        html: renderEmailLayout({
          title: "Revisa tu medio de pago",
          bodyHtml: paragraph(text),
          action,
        }),
      };
    }
    case "billing_grace_ending": {
      const text = `Tu plan ${input.planLabel} sigue pendiente de pago. Si no se cobra antes del ${graceDate(input)}, tu cuenta pasará al plan Básico. No se borrará ningún dato.`;
      return {
        subject: "Tu plan pasará a Básico en dos días",
        text: `${text}\n\n${action.label}: ${action.url}`,
        html: renderEmailLayout({
          title: "Quedan dos días de gracia",
          bodyHtml: paragraph(text),
          action,
        }),
      };
    }
    case "billing_downgraded": {
      const text =
        "Tu cuenta ha pasado al plan Básico. Tus documentos, clientes y configuración se conservan tal como estaban; las funciones de pago vuelven en cuanto mejores de nuevo.";
      return {
        subject: "Tu cuenta ha pasado al plan Básico",
        text: `${text}\n\nVolver a mejorar: ${action.url}`,
        html: renderEmailLayout({
          title: "Ahora estás en el plan Básico",
          bodyHtml: paragraph(text),
          action: { label: "Ver planes", url: input.billingUrl },
        }),
      };
    }
    case "billing_plan_activated": {
      const text = `Tu plan ${input.planLabel} ya está activo. Gracias por confiar en Factum.`;
      return {
        subject: `Plan ${input.planLabel} activado`,
        text: `${text}\n\n${action.label}: ${action.url}`,
        html: renderEmailLayout({
          title: `Bienvenido al plan ${input.planLabel}`,
          bodyHtml: paragraph(text),
          action,
        }),
      };
    }
  }
}

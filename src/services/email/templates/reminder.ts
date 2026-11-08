import { createCents, formatEur } from "@/lib/money";
import {
  paragraph,
  type RenderedEmail,
  renderEmailLayout,
} from "@/services/email/templates/layout";

export interface PaymentReminderInput {
  issuerName: string;
  documentNumber: string;
  /** `YYYY-MM-DD`. */
  dueDate: string | null;
  pendingCents: number;
  /** Payment lines of the frozen collection method (label, IBAN…). */
  paymentLines: string[];
  publicUrl: string | null;
  /** `YYYY-MM-DD` Europe/Madrid, to word «vence» vs «venció». */
  today: string;
}

function spanishDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

/** Reminder to the client; amounts come from the stored invoice (FR-041). */
export function renderPaymentReminder(
  input: PaymentReminderInput,
): RenderedEmail {
  const amount = formatEur(createCents(input.pendingCents));
  const when = input.dueDate
    ? input.dueDate < input.today
      ? `venció el ${spanishDate(input.dueDate)}`
      : input.dueDate === input.today
        ? "vence hoy"
        : `vence el ${spanishDate(input.dueDate)}`
    : "está pendiente de pago";
  const intro = `Te recordamos que la factura ${input.documentNumber} de ${input.issuerName} ${when}. Importe pendiente: ${amount}.`;
  const how =
    input.paymentLines.length > 0
      ? `Puedes pagarla así:\n${input.paymentLines.join("\n")}`
      : "";
  const text = [intro, how].filter(Boolean).join("\n\n");
  return {
    subject: `Recordatorio de pago: factura ${input.documentNumber}`,
    text: input.publicUrl ? `${text}\n\nVer factura: ${input.publicUrl}` : text,
    html: renderEmailLayout({
      title: "Recordatorio de pago",
      bodyHtml: [intro, how]
        .filter(Boolean)
        .map((block) => paragraph(block))
        .join(""),
      ...(input.publicUrl
        ? { action: { label: "Ver factura", url: input.publicUrl } }
        : {}),
      footnote:
        "Si ya la has pagado, ignora este mensaje: puede haberse cruzado con tu pago.",
    }),
  };
}

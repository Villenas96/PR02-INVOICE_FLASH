/**
 * In-app notices (research R21). Each kind renders its Spanish copy from a
 * payload that never holds NIF, IBAN, amounts or emails: only ids, document
 * numbers, counts and reason codes.
 */

export const NOTIFICATION_KINDS = [
  "recurring_generated",
  "recurring_failed",
  "recurring_skipped_plan",
  "export_ready",
  "export_failed",
  "import_ready",
  "import_done",
  "import_failed",
  "reminder_failed",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type NotificationPayload = Record<
  string,
  string | number | boolean | null
>;

export interface RenderedNotification {
  title: string;
  body: string;
  /** In-app path to act on the notice, if any. */
  href: string | null;
}

function text(payload: NotificationPayload, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function count(payload: NotificationPayload, key: string): number {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function documentHref(payload: NotificationPayload): string | null {
  const id = text(payload, "document_id");
  return id ? `/documents/${id}` : null;
}

export function renderNotification(
  kind: string,
  payload: NotificationPayload,
): RenderedNotification {
  switch (kind as NotificationKind) {
    case "recurring_generated": {
      const number = text(payload, "document_number");
      return {
        title: "Factura recurrente generada",
        body: number
          ? `Se ha generado la factura ${number}.`
          : "Se ha generado un borrador desde una factura recurrente.",
        href: documentHref(payload),
      };
    }
    case "recurring_failed":
      return {
        title: "No se pudo generar una factura recurrente",
        body: "Revisa la plantilla: el cliente o la serie pueden haber cambiado.",
        href: text(payload, "template_id")
          ? `/recurring/${text(payload, "template_id")}`
          : "/recurring",
      };
    case "recurring_skipped_plan":
      return {
        title: "Factura recurrente pendiente",
        body: "Has alcanzado el límite de tu plan este mes; el ciclo quedó sin emitir.",
        href: "/billing",
      };
    case "export_ready":
      return {
        title: "Exportación lista",
        body: "Tu exportación está lista para descargar durante 7 días.",
        href: "/exports",
      };
    case "export_failed":
      return {
        title: "La exportación ha fallado",
        body: "No hemos podido generar la exportación. Inténtalo de nuevo.",
        href: "/exports",
      };
    case "import_ready":
      return {
        title: "Importación lista para revisar",
        body: `Hemos analizado ${count(payload, "rows")} filas. Revisa la vista previa y confirma.`,
        href: text(payload, "import_id")
          ? `/catalog/import?id=${text(payload, "import_id")}`
          : "/catalog/import",
      };
    case "import_done":
      return {
        title: "Importación completada",
        body: `${count(payload, "created")} creados, ${count(payload, "updated")} actualizados, ${count(payload, "skipped")} omitidos y ${count(payload, "errored")} con errores.`,
        href: "/catalog",
      };
    case "import_failed":
      return {
        title: "La importación ha fallado",
        body: "No hemos podido procesar el archivo. Revisa su formato e inténtalo de nuevo.",
        href: "/catalog/import",
      };
    case "reminder_failed":
      return {
        title: "No se pudo enviar un recordatorio",
        body: "Comprueba el email del cliente de la factura.",
        href: documentHref(payload),
      };
    default:
      return { title: "Aviso", body: "Tienes un aviso nuevo.", href: null };
  }
}

/** Rejects payload values that look like sensitive data (defense in depth). */
export function assertSafeNotificationPayload(
  payload: NotificationPayload,
): void {
  for (const [key, value] of Object.entries(payload)) {
    if (/email|iban|nif|tax_id|amount|cents|token/i.test(key)) {
      throw new Error(`Campo no permitido en un aviso: ${key}`);
    }
    if (
      typeof value === "string" &&
      /@|^[A-Z]{2}\d{2}[A-Z0-9]{10,}$/i.test(value)
    ) {
      throw new Error(`Valor no permitido en un aviso: ${key}`);
    }
  }
}

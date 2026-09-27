"use client";

import { useCallback, useEffect, useState } from "react";

import { useAsyncAction } from "@/components/ui/async-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, jsonRequest } from "@/lib/api/client";

interface ShareLinkData {
  url: string;
  token: string;
  disabled_at: string | null;
}

interface EmailDeliveryItem {
  id: string;
  status: "failed" | "queued" | "sending" | "sent";
  attempt_count: number;
  last_error_code: string | null;
  sent_at: string | null;
  created_at: string;
}

interface EmailDeliveryPage {
  items: EmailDeliveryItem[];
  next_cursor: string | null;
}

const STATUS_LABELS: Record<EmailDeliveryItem["status"], string> = {
  queued: "En cola",
  sending: "Enviando",
  sent: "Enviado",
  failed: "Fallido",
};

function formattedDateTime(date: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Madrid",
  }).format(new Date(date));
}

function ShareLinkControls({ documentId }: { documentId: string }) {
  const [link, setLink] = useState<ShareLinkData>();
  const [copied, setCopied] = useState(false);
  const createAction = useAsyncAction<ShareLinkData>();
  const disableAction = useAsyncAction<ShareLinkData>();

  async function handleCreate() {
    const created = await createAction.run(() =>
      apiRequest<ShareLinkData>(`/api/v1/documents/${documentId}/share-link`, {
        method: "POST",
      }),
    );
    if (created) {
      setLink(created);
    }
  }

  async function handleDisable() {
    const disabled = await disableAction.run(() =>
      apiRequest<ShareLinkData>(`/api/v1/documents/${documentId}/share-link`, {
        method: "DELETE",
      }),
    );
    if (disabled) {
      setLink(disabled);
    }
  }

  async function handleCopy() {
    if (!link) {
      return;
    }
    await navigator.clipboard.writeText(link.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  }

  const isActive = link && link.disabled_at === null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={createAction.isLoading}
          onClick={handleCreate}
        >
          {createAction.isLoading
            ? "Generando…"
            : link
              ? "Actualizar enlace"
              : "Generar enlace público"}
        </Button>
        {isActive ? (
          <Button
            type="button"
            variant="ghost"
            disabled={disableAction.isLoading}
            onClick={handleDisable}
          >
            {disableAction.isLoading ? "Desactivando…" : "Desactivar enlace"}
          </Button>
        ) : null}
      </div>
      {createAction.error ? (
        <p role="alert" className="text-sm text-destructive">
          {createAction.error}
        </p>
      ) : null}
      {disableAction.error ? (
        <p role="alert" className="text-sm text-destructive">
          {disableAction.error}
        </p>
      ) : null}
      {link ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={isActive ? "outline" : "secondary"}>
            {isActive ? "Activo" : "Desactivado"}
          </Badge>
          <Input readOnly value={link.url} className="max-w-md" />
          <Button type="button" variant="ghost" size="sm" onClick={handleCopy}>
            {copied ? "¡Copiado!" : "Copiar"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function EmailForm({
  documentId,
  canSendEmail,
  onSent,
}: {
  documentId: string;
  canSendEmail: boolean;
  onSent: () => void;
}) {
  const [recipientEmail, setRecipientEmail] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const action = useAsyncAction<{ delivery_id: string; status: string }>();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sent = await action.run(() =>
      apiRequest<{ delivery_id: string; status: string }>(
        `/api/v1/documents/${documentId}/email`,
        {
          ...jsonRequest("POST", {
            recipient_email: recipientEmail.trim(),
            custom_message: customMessage.trim() || null,
          }),
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
        },
      ),
    );
    if (sent) {
      setRecipientEmail("");
      setCustomMessage("");
      onSent();
    }
  }

  if (!canSendEmail) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        <p>El envío por correo está disponible en el plan de pago.</p>
        <p className="mt-1">
          Mientras tanto, puedes copiar el enlace público o descargar el PDF.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="share-email-recipient">Correo del destinatario</Label>
          <Input
            id="share-email-recipient"
            type="email"
            required
            value={recipientEmail}
            onChange={(event) => setRecipientEmail(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="share-email-message">Mensaje (opcional)</Label>
          <Input
            id="share-email-message"
            value={customMessage}
            onChange={(event) => setCustomMessage(event.target.value)}
          />
        </div>
      </div>
      {action.error ? (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      ) : null}
      <Button type="submit" disabled={action.isLoading}>
        {action.isLoading ? "Enviando…" : "Enviar por correo"}
      </Button>
    </form>
  );
}

export function SharePanel({
  documentId,
  canSendEmail,
}: {
  documentId: string;
  canSendEmail: boolean;
}) {
  const [deliveries, setDeliveries] = useState<EmailDeliveryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadDeliveries = useCallback(async () => {
    try {
      const page = await apiRequest<EmailDeliveryPage>(
        `/api/v1/documents/${documentId}/email-deliveries`,
      );
      setDeliveries(page.items);
    } catch {
      // The history is a convenience view; a load failure keeps the panel usable.
    } finally {
      setIsLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    void loadDeliveries();
  }, [loadDeliveries]);

  return (
    <section className="space-y-5 rounded-xl border bg-card p-5 shadow-sm">
      <div>
        <h2 className="font-semibold">Compartir y enviar</h2>
        <p className="text-sm text-muted-foreground">
          Comparte un enlace público de solo lectura o envía el documento por
          correo.
        </p>
      </div>

      <ShareLinkControls documentId={documentId} />

      <EmailForm
        documentId={documentId}
        canSendEmail={canSendEmail}
        onSent={loadDeliveries}
      />

      {!isLoading && deliveries.length > 0 ? (
        <div>
          <h3 className="text-sm font-medium">Historial de envíos</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {deliveries.map((delivery) => (
              <li
                key={delivery.id}
                className="flex items-center justify-between gap-3 rounded-lg border p-2"
              >
                <Badge
                  variant={
                    delivery.status === "failed"
                      ? "destructive"
                      : delivery.status === "sent"
                        ? "default"
                        : "outline"
                  }
                >
                  {STATUS_LABELS[delivery.status]}
                </Badge>
                <span className="text-muted-foreground">
                  {formattedDateTime(delivery.sent_at ?? delivery.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

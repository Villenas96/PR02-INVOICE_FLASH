"use client";

import { useCallback, useEffect, useState } from "react";

import { FeatureUpsell } from "@/components/plan/feature-upsell";
import { useMutation } from "@/components/ui/async-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, jsonRequest } from "@/lib/api/client";

interface AdvisorAccess {
  id: string;
  status: "pending" | "active" | "revoked" | "expired";
  email: string | null;
  invited_at: string;
  accepted_at: string | null;
  expires_at: string;
  last_access_at: string | null;
}

interface AccessEvent {
  id: string;
  action: "session_started" | "exported" | "downloaded_pdf" | "access_revoked";
  actor_email: string;
  created_at: string;
}

interface AdvisorAccessPage {
  accesses: AdvisorAccess[];
  events: AccessEvent[];
  next_cursor: string | null;
}

const STATUS_LABELS: Record<AdvisorAccess["status"], string> = {
  pending: "Invitación pendiente",
  active: "Con acceso",
  revoked: "Acceso retirado",
  expired: "Invitación caducada",
};

const ACTION_LABELS: Record<AccessEvent["action"], string> = {
  session_started: "Entró a consultar",
  exported: "Exportó documentos",
  downloaded_pdf: "Descargó un PDF",
  access_revoked: "Acceso retirado",
};

const dateFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Madrid",
});

function formatDate(value: string | null): string {
  return value ? dateFormatter.format(new Date(value)) : "—";
}

function RevokeButton({
  access,
  onRevoked,
}: {
  access: AdvisorAccess;
  onRevoked: () => void;
}) {
  const action = useMutation<null>();
  const [confirming, setConfirming] = useState(false);

  async function revoke() {
    const result = await action.run(() =>
      apiRequest<void>(`/api/v1/advisor-access/${access.id}`, {
        method: "DELETE",
      }).then(() => null),
    );
    if (result === null) {
      onRevoked();
    }
  }

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setConfirming(true)}
      >
        Retirar acceso
      </Button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={action.isLoading}
        onClick={revoke}
      >
        {action.isLoading ? "Retirando…" : "Confirmar"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setConfirming(false)}
      >
        Cancelar
      </Button>
      {action.error ? (
        <span role="alert" className="text-xs text-destructive">
          {action.error}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Read-only access for the advisor (FR-050–053): invite by email (7-day
 * invitation), revoke with immediate effect and see what they did.
 */
export function AdvisorSettings({ enabled }: { enabled: boolean }) {
  const [page, setPage] = useState<AdvisorAccessPage | null>(null);
  const [email, setEmail] = useState("");
  const invite = useMutation<{ id: string }>();

  const load = useCallback(async () => {
    setPage(await apiRequest<AdvisorAccessPage>("/api/v1/advisor-access"));
  }, []);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  async function handleInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await invite.run(() =>
      apiRequest<{ id: string }>(
        "/api/v1/advisor-access",
        jsonRequest("POST", { email: email.trim() }),
      ),
    );
    if (created) {
      setEmail("");
      await load();
    }
  }

  const accesses = page?.accesses ?? [];
  return (
    <div className="space-y-6">
      {enabled ? (
        <form
          onSubmit={handleInvite}
          aria-labelledby="advisor-invite-title"
          className="space-y-4 rounded-xl border bg-card p-5 shadow-sm sm:p-6"
        >
          <div className="space-y-1">
            <h2 id="advisor-invite-title" className="text-lg font-semibold">
              Invitar a tu gestoría
            </h2>
            <p className="text-sm text-muted-foreground">
              Podrá consultar documentos, clientes y cobros, descargar PDF y
              exportar, pero nunca modificar nada. La invitación caduca a los 7
              días.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="advisor-invite-email">Email de la gestoría</Label>
              <Input
                id="advisor-invite-email"
                type="email"
                required
                maxLength={320}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={invite.isLoading}>
              {invite.isLoading ? "Enviando…" : "Enviar invitación"}
            </Button>
          </div>
          {invite.error ? (
            <p role="alert" className="text-sm text-destructive">
              {invite.error}
            </p>
          ) : invite.status === "success" ? (
            <output className="block text-sm">Invitación enviada.</output>
          ) : null}
        </form>
      ) : (
        <FeatureUpsell feature="advisor_access" variant="inline" />
      )}

      <section
        aria-labelledby="advisor-list-title"
        className="space-y-4 rounded-xl border bg-card p-5 shadow-sm sm:p-6"
      >
        <h2 id="advisor-list-title" className="text-lg font-semibold">
          Accesos
        </h2>
        {accesses.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Todavía no has invitado a nadie.
          </p>
        ) : (
          <ul className="divide-y">
            {accesses.map((access) => (
              <li
                key={access.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">{access.email ?? "Invitación"}</p>
                  <p className="text-xs text-muted-foreground">
                    {access.status === "active"
                      ? `Último acceso: ${formatDate(access.last_access_at)}`
                      : access.status === "pending"
                        ? `Caduca: ${formatDate(access.expires_at)}`
                        : `Invitada: ${formatDate(access.invited_at)}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge
                    variant={access.status === "active" ? "default" : "outline"}
                  >
                    {STATUS_LABELS[access.status]}
                  </Badge>
                  {access.status === "active" || access.status === "pending" ? (
                    <RevokeButton access={access} onRevoked={load} />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="advisor-log-title"
        className="space-y-4 rounded-xl border bg-card p-5 shadow-sm sm:p-6"
      >
        <h2 id="advisor-log-title" className="text-lg font-semibold">
          Registro de actividad
        </h2>
        {(page?.events.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">Sin actividad.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {page?.events.map((event) => (
              <li key={event.id} className="flex flex-wrap gap-x-2">
                <span className="text-muted-foreground">
                  {formatDate(event.created_at)}
                </span>
                <span>
                  {event.actor_email} · {ACTION_LABELS[event.action]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

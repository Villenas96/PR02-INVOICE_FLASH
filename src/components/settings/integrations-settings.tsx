"use client";

import { useCallback, useEffect, useState } from "react";

import { FeatureUpsell } from "@/components/plan/feature-upsell";
import { useMutation } from "@/components/ui/async-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api/client";

interface AiConnection {
  id: string;
  client_name: string;
  status: "active" | "revoked";
  authorized_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

const dateFormatter = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(value: string | null): string {
  return value ? dateFormatter.format(new Date(value)) : "Nunca";
}

function RevokeButton({
  connection,
  onRevoked,
}: {
  connection: AiConnection;
  onRevoked: () => Promise<void>;
}) {
  const revoke = useMutation<null>();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={revoke.isLoading}
        aria-label={`Revocar el acceso de ${connection.client_name}`}
        onClick={async () => {
          await revoke.run(async () => {
            await apiRequest(`/api/v1/ai-connections/${connection.id}`, {
              method: "DELETE",
            });
            return null;
          });
          await onRevoked();
        }}
      >
        {revoke.isLoading ? "Revocando…" : "Revocar acceso"}
      </Button>
      {revoke.error ? (
        <p role="alert" className="text-xs text-destructive">
          {revoke.error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Assistants connected to the company (FR-054): what each one is, when it was
 * last used, and an immediate revoke.
 */
export function IntegrationsSettings({ enabled }: { enabled: boolean }) {
  const [connections, setConnections] = useState<AiConnection[] | null>(null);
  const [origin, setOrigin] = useState("");

  const load = useCallback(async () => {
    const page = await apiRequest<{ items: AiConnection[] }>(
      "/api/v1/ai-connections",
    );
    setConnections(page.items);
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    if (enabled) {
      void load().catch(() => setConnections([]));
    }
  }, [enabled, load]);

  if (!enabled) {
    return <FeatureUpsell feature="ai_assistant" variant="inline" />;
  }
  const active = (connections ?? []).filter((item) => item.status === "active");
  const past = (connections ?? []).filter((item) => item.status !== "active");
  return (
    <div className="space-y-6">
      <section
        aria-labelledby="ai-connect-title"
        className="space-y-3 rounded-xl border bg-card p-5 shadow-sm sm:p-6"
      >
        <h2 id="ai-connect-title" className="text-lg font-semibold">
          Conectar un asistente de IA
        </h2>
        <p className="text-sm text-muted-foreground">
          En tu asistente (por ejemplo Claude o ChatGPT) añade un conector MCP
          con esta dirección y autoriza el acceso cuando te lo pida. Podrá
          buscar clientes, preparar borradores y registrar cobros; para emitir o
          anular siempre te pedirá confirmación.
        </p>
        <p>
          <code className="rounded bg-muted px-2 py-1 text-sm">
            {origin}/api/mcp
          </code>
        </p>
      </section>

      <section
        aria-labelledby="ai-list-title"
        className="space-y-4 rounded-xl border bg-card p-5 shadow-sm sm:p-6"
      >
        <h2 id="ai-list-title" className="text-lg font-semibold">
          Asistentes conectados
        </h2>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay ningún asistente conectado.
          </p>
        ) : (
          <ul className="divide-y">
            {active.map((connection) => (
              <li
                key={connection.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">{connection.client_name}</p>
                  <p className="text-xs text-muted-foreground">
                    Autorizado: {formatDate(connection.authorized_at)} · Último
                    uso: {formatDate(connection.last_used_at)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge>Activo</Badge>
                  <RevokeButton connection={connection} onRevoked={load} />
                </div>
              </li>
            ))}
          </ul>
        )}
        {past.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Conexiones revocadas ({past.length})
            </summary>
            <ul className="mt-2 space-y-1">
              {past.map((connection) => (
                <li key={connection.id}>
                  {connection.client_name} · revocada el{" "}
                  {formatDate(connection.revoked_at)}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
    </div>
  );
}

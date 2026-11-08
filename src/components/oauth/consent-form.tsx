"use client";

import { useEffect, useState } from "react";
import { FeatureUpsell } from "@/components/plan/feature-upsell";
import { companyHasFeature } from "@/components/plan/types";
import type { CompanySettings } from "@/components/settings/types";
import { Button } from "@/components/ui/button";
import { apiRequest, jsonRequest } from "@/lib/api/client";

interface PublicClient {
  client_name?: string;
  client_uri?: string;
}

const CAPABILITIES = [
  "Buscar y consultar tus clientes, productos y documentos.",
  "Crear clientes y productos, y preparar borradores de documentos.",
  "Registrar cobros y enviar por correo documentos ya emitidos.",
];

/**
 * Explicit consent for an AI assistant (FR-054). Emitting and voiding are not
 * granted: they always need a separate confirmation of the person (FR-056).
 */
export function ConsentForm() {
  const [query, setQuery] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [client, setClient] = useState<PublicClient | null>(null);
  const [company, setCompany] = useState<CompanySettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const search = window.location.search.slice(1);
    const id = new URLSearchParams(search).get("client_id");
    setQuery(search);
    setClientId(id);
    void apiRequest<CompanySettings>("/api/v1/company")
      .then(setCompany)
      .catch(() => setError("No se ha podido cargar tu empresa."));
    if (id) {
      void apiRequest<PublicClient>(
        `/api/auth/oauth2/public-client?client_id=${encodeURIComponent(id)}`,
      )
        .then(setClient)
        .catch(() => setClient({}));
    }
  }, []);

  async function decide(accept: boolean) {
    if (!query || !clientId) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (accept) {
        await apiRequest(
          "/api/v1/ai-connections",
          jsonRequest("POST", { oauth_client_id: clientId }),
        );
      }
      const outcome = await apiRequest<{ url?: string }>(
        "/api/auth/oauth2/consent",
        jsonRequest("POST", { accept, oauth_query: query }),
      );
      if (outcome.url) {
        window.location.assign(outcome.url);
        return;
      }
      setError("No se ha podido completar la autorización.");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "No se ha podido completar la autorización.",
      );
    }
    setBusy(false);
  }

  if (!clientId) {
    return (
      <p role="alert" className="text-sm text-destructive">
        La solicitud de autorización no es válida. Vuelve a empezar desde tu
        asistente.
      </p>
    );
  }
  if (company && !companyHasFeature(company, "ai_assistant")) {
    return <FeatureUpsell feature="ai_assistant" variant="inline" />;
  }
  if (company && company.role !== "owner") {
    return (
      <p role="alert" className="text-sm text-destructive">
        Solo la persona titular puede conectar un asistente.
      </p>
    );
  }
  const name = client?.client_name?.trim() || "Un asistente de IA";
  return (
    <section
      aria-labelledby="consent-title"
      className="max-w-xl space-y-5 rounded-xl border bg-card p-6 shadow-sm"
    >
      <h2 id="consent-title" className="text-xl font-semibold">
        {name} quiere acceder a tu empresa
      </h2>
      <p className="text-sm text-muted-foreground">
        Si lo permites, podrá, en nombre de{" "}
        <strong>{company?.legal_name ?? "tu empresa"}</strong>:
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {CAPABILITIES.map((capability) => (
          <li key={capability}>{capability}</li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">
        <strong>Emitir y anular</strong> nunca ocurre sin que lo confirmes
        expresamente. Puedes revocar el acceso cuando quieras en Ajustes →
        Asistentes de IA.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          disabled={busy || !company}
          onClick={() => decide(true)}
        >
          {busy ? "Autorizando…" : "Permitir acceso"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => decide(false)}
        >
          Cancelar
        </Button>
      </div>
    </section>
  );
}

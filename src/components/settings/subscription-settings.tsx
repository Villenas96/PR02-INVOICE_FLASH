"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useMutation } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api/client";
import { type Plan, planLabel } from "@/lib/plan";

interface SubscriptionData {
  plan: Plan;
  effective_plan: Plan;
  interval: "month" | "year" | null;
  status: "active" | "past_due" | "canceled" | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  grace_until: string | null;
}

const dateFormatter = new Intl.DateTimeFormat("es-ES", {
  timeZone: "Europe/Madrid",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function formatDate(value: string): string {
  return dateFormatter.format(new Date(value));
}

/** «Suscripción» section of the settings (FR-011, T046). */
export function SubscriptionSettings() {
  const [data, setData] = useState<SubscriptionData>();
  const [loadError, setLoadError] = useState<string>();
  const portal = useMutation<{ url: string }>({ refresh: false });

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<SubscriptionData>("/api/v1/billing/subscription", {
      signal: controller.signal,
    })
      .then(setData)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setLoadError(
          error instanceof Error
            ? error.message
            : "No se ha podido cargar tu suscripción.",
        );
      });
    return () => controller.abort();
  }, []);

  async function openPortal() {
    const result = await portal.run(() =>
      apiRequest<{ url: string }>("/api/v1/billing/portal", { method: "POST" }),
    );
    if (result) {
      window.location.assign(result.url);
    }
  }

  return (
    <section
      id="subscription"
      aria-labelledby="subscription-title"
      className="space-y-4 rounded-xl border bg-card p-5 shadow-sm sm:p-6"
    >
      <div>
        <h2 id="subscription-title" className="font-semibold">
          Suscripción
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Cambia de plan o de periodicidad, actualiza tu medio de pago y
          descarga las facturas de tu suscripción.
        </p>
      </div>
      {loadError ? (
        <p role="alert" className="text-sm text-destructive">
          {loadError}
        </p>
      ) : !data ? (
        <output className="block h-16 animate-pulse rounded-lg bg-muted/50">
          <span className="sr-only">Cargando suscripción…</span>
        </output>
      ) : (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Plan actual</dt>
            <dd className="font-medium">{planLabel(data.effective_plan)}</dd>
          </div>
          {data.interval ? (
            <div>
              <dt className="text-muted-foreground">Periodicidad</dt>
              <dd>{data.interval === "month" ? "Mensual" : "Anual"}</dd>
            </div>
          ) : null}
          {data.current_period_end && data.status === "active" ? (
            <div>
              <dt className="text-muted-foreground">
                {data.cancel_at_period_end ? "Termina el" : "Se renueva el"}
              </dt>
              <dd>{formatDate(data.current_period_end)}</dd>
            </div>
          ) : null}
          {data.status === "past_due" && data.grace_until ? (
            <div className="sm:col-span-2">
              <dt className="sr-only">Pago pendiente</dt>
              <dd className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                No hemos podido cobrar la renovación. Actualiza tu medio de pago
                antes del {formatDate(data.grace_until)} para conservar tu plan;
                tus datos no se borrarán en ningún caso.
              </dd>
            </div>
          ) : null}
        </dl>
      )}
      {portal.error ? (
        <p role="alert" className="text-sm text-destructive">
          {portal.error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {data?.status ? (
          <Button
            type="button"
            variant="outline"
            disabled={portal.isLoading}
            onClick={openPortal}
          >
            {portal.isLoading ? "Abriendo…" : "Gestionar suscripción"}
          </Button>
        ) : null}
        {data && data.effective_plan !== "pro" ? (
          <Button asChild>
            <Link href="/billing">Mejorar</Link>
          </Button>
        ) : null}
      </div>
    </section>
  );
}

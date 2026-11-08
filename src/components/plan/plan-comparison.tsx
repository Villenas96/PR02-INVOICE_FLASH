"use client";

import { CheckIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { featureTitle } from "@/components/plan/feature-upsell";
import { useMutation } from "@/components/ui/async-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest, jsonRequest } from "@/lib/api/client";
import { createCents, formatEur } from "@/lib/money";
import type { Feature, Plan } from "@/lib/plan";
import { cn } from "@/lib/utils";

type Interval = "month" | "year";

interface PlanPrice {
  lookup_key: string;
  interval: Interval;
  unit_amount_cents: number;
  currency: string;
}

interface PlanOption {
  plan: Plan;
  label: string;
  current: boolean;
  purchasable: boolean;
  coming_soon: boolean;
  limits: Array<{ document_type: string; limit: number }>;
  features: Feature[];
  prices: PlanPrice[];
}

interface PlansResponse {
  current_plan: Plan;
  plans: PlanOption[];
}

const BASE_FEATURES = [
  "Facturas, proformas, recibos, presupuestos y albaranes",
  "PDF profesional y enlace público",
  "Clientes, productos, cobros e impuestos propios",
  "Resumen de cobrado, pendiente y vencido",
];

const NOTICES = {
  activated: "Tu plan se ha activado. Ya puedes usar sus funciones.",
  canceled:
    "No se ha completado el pago. Tu plan no ha cambiado y tus borradores siguen intactos.",
  updated: "Tu suscripción se ha actualizado.",
} as const;

function limitText(option: PlanOption): string {
  const limit = option.limits[0]?.limit ?? 0;
  return option.plan === "pro"
    ? "Sin límite comercial de documentos"
    : `${limit.toLocaleString("es-ES")} documentos de cada tipo al mes`;
}

function PriceTag({
  option,
  interval,
}: {
  option: PlanOption;
  interval: Interval;
}) {
  if (option.plan === "basic") {
    return <p className="text-3xl font-semibold">Gratis</p>;
  }
  const price = option.prices.find((entry) => entry.interval === interval);
  if (!price) {
    return (
      <p className="text-sm text-muted-foreground">Precio no disponible</p>
    );
  }
  return (
    <p>
      <span className="text-3xl font-semibold">
        {formatEur(createCents(price.unit_amount_cents))}
      </span>{" "}
      <span className="text-sm text-muted-foreground">
        /{interval === "month" ? "mes" : "año"}, IVA incluido
      </span>
    </p>
  );
}

/** Three-plan comparison with monthly/annual prices (FR-007, US2). */
export function PlanComparison({
  resumeDocumentId,
  notice,
}: {
  resumeDocumentId?: string;
  notice?: keyof typeof NOTICES;
}) {
  const [data, setData] = useState<PlansResponse>();
  const [loadError, setLoadError] = useState<string>();
  const [interval, setInterval] = useState<Interval>("month");
  const [pendingPlan, setPendingPlan] = useState<Plan>();
  const checkout = useMutation<{ url: string }>({ refresh: false });

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<PlansResponse>("/api/v1/billing/plans", {
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
            : "No se han podido cargar los planes.",
        );
      });
    return () => controller.abort();
  }, []);

  async function subscribe(option: PlanOption) {
    const price = option.prices.find((entry) => entry.interval === interval);
    if (!price) {
      return;
    }
    setPendingPlan(option.plan);
    const result = await checkout.run(() =>
      apiRequest<{ url: string }>("/api/v1/billing/checkout", {
        ...jsonRequest("POST", {
          lookup_key: price.lookup_key,
          ...(resumeDocumentId ? { resume_document_id: resumeDocumentId } : {}),
        }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
      }),
    );
    if (result) {
      window.location.assign(result.url);
      return;
    }
    setPendingPlan(undefined);
  }

  async function openPortal() {
    const result = await checkout.run(() =>
      apiRequest<{ url: string }>("/api/v1/billing/portal", {
        method: "POST",
      }),
    );
    if (result) {
      window.location.assign(result.url);
    }
  }

  return (
    <div className="space-y-6">
      {notice ? (
        <output className="block rounded-lg border bg-card p-4 text-sm shadow-sm">
          {NOTICES[notice]}
        </output>
      ) : null}
      {resumeDocumentId ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          Tu borrador se conserva sin número. Al completar el pago lo emitiremos
          automáticamente.
        </p>
      ) : null}

      <fieldset className="inline-flex rounded-lg border bg-card p-1">
        <legend className="sr-only">Periodicidad</legend>
        {(["month", "year"] as const).map((value) => (
          <label
            key={value}
            className={cn(
              "cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
              interval === value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <input
              type="radio"
              name="billing-interval"
              value={value}
              className="sr-only"
              checked={interval === value}
              onChange={() => setInterval(value)}
            />
            {value === "month" ? "Mensual" : "Anual"}
          </label>
        ))}
      </fieldset>

      {loadError ? (
        <p role="alert" className="text-sm text-destructive">
          {loadError}
        </p>
      ) : null}
      {checkout.error ? (
        <p role="alert" className="text-sm text-destructive">
          {checkout.error}
        </p>
      ) : null}

      {!data ? (
        <output className="block h-96 animate-pulse rounded-xl border bg-muted/50">
          <span className="sr-only">Cargando planes…</span>
        </output>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {data.plans.map((option) => (
            <section
              key={option.plan}
              aria-labelledby={`plan-${option.plan}`}
              className={cn(
                "flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-sm",
                option.current && "border-primary ring-1 ring-primary",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <h2
                  id={`plan-${option.plan}`}
                  className="text-lg font-semibold"
                >
                  {option.label}
                </h2>
                {option.current ? <Badge>Tu plan</Badge> : null}
                {option.coming_soon ? (
                  <Badge variant="outline">Próximamente</Badge>
                ) : null}
              </div>
              <PriceTag option={option} interval={interval} />
              <p className="text-sm font-medium">{limitText(option)}</p>
              <ul className="flex-1 space-y-2 text-sm">
                {[...BASE_FEATURES, ...option.features.map(featureTitle)].map(
                  (feature) => (
                    <li key={feature} className="flex gap-2">
                      <CheckIcon
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 text-primary"
                      />
                      <span>{feature}</span>
                    </li>
                  ),
                )}
              </ul>
              {option.current ? (
                <Button variant="outline" disabled>
                  Plan actual
                </Button>
              ) : option.purchasable ? (
                <Button
                  onClick={() => subscribe(option)}
                  disabled={checkout.isLoading}
                >
                  {pendingPlan === option.plan && checkout.isLoading
                    ? "Abriendo el pago…"
                    : `Contratar ${option.label}`}
                </Button>
              ) : option.plan === "basic" ? (
                <Button
                  variant="outline"
                  onClick={openPortal}
                  disabled={checkout.isLoading}
                >
                  Gestionar suscripción
                </Button>
              ) : null}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

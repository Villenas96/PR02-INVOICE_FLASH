"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { CollectionMethodSettings } from "@/components/settings/collection-method-settings";
import { CompanyProfileForm } from "@/components/settings/company-settings";
import { LogoSettings } from "@/components/settings/logo-settings";
import type { CompanySettings } from "@/components/settings/types";
import { Button } from "@/components/ui/button";
import { apiRequest, jsonRequest } from "@/lib/api/client";
import type { OnboardingProgress, OnboardingStep } from "@/lib/onboarding";

type WizardCompany = CompanySettings & { onboarding: OnboardingProgress };

const STEP_TITLES: Record<OnboardingStep, string> = {
  fiscal_data: "Tus datos fiscales",
  logo: "Tu logotipo",
  collection_method: "Cómo te pagan",
  series: "Numeración de tus facturas",
  sample_invoice: "Una factura de ejemplo",
};

function StepList({
  progress,
  selected,
  onSelect,
}: {
  progress: OnboardingProgress;
  selected: OnboardingStep;
  onSelect: (step: OnboardingStep) => void;
}) {
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Pasos de la configuración">
      {progress.steps.map((entry, index) => (
        <li key={entry.step}>
          <button
            type="button"
            onClick={() => onSelect(entry.step)}
            aria-current={entry.step === selected ? "step" : undefined}
            className="rounded-full border px-3 py-1 text-sm aria-[current=step]:border-foreground aria-[current=step]:font-medium"
          >
            {index + 1}. {entry.label}
            <span className="sr-only">
              {entry.status === "done"
                ? " (hecho)"
                : entry.status === "skipped"
                  ? " (omitido)"
                  : ""}
            </span>
            {entry.status === "done" ? " ✓" : ""}
            {entry.status === "skipped" ? " –" : ""}
          </button>
        </li>
      ))}
    </ol>
  );
}

/** Waits for the queue to render the sample, then shows it. */
function SampleStep({ onDone }: { onDone: () => void }) {
  const [sampleId, setSampleId] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    return () => {
      stopped.current = true;
    };
  }, []);

  useEffect(() => {
    if (!sampleId) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const response = await fetch(
          `/api/v1/company/onboarding/sample/${sampleId}`,
          { credentials: "same-origin" },
        );
        if (stopped.current) {
          return;
        }
        if (response.status === 200) {
          setUrl(URL.createObjectURL(await response.blob()));
          setBusy(false);
          return;
        }
        if (response.status === 202) {
          timer = setTimeout(poll, 1_000);
          return;
        }
        setError("No hemos podido generar el ejemplo. Inténtalo de nuevo.");
      } catch {
        setError("No hemos podido generar el ejemplo. Inténtalo de nuevo.");
      }
      setBusy(false);
    }
    void poll();
    return () => clearTimeout(timer);
  }, [sampleId]);

  async function generate() {
    setBusy(true);
    setError(null);
    setUrl(null);
    try {
      const created = await apiRequest<{ sample_id: string }>(
        "/api/v1/company/onboarding/sample",
        { method: "POST" },
      );
      setSampleId(created.sample_id);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "No hemos podido generar el ejemplo.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Genera un PDF con tus datos y unas líneas inventadas para ver cómo
        quedarán tus facturas. Lleva la marca «EJEMPLO – sin validez»: no es una
        factura, no gasta número ni cupo.
      </p>
      <Button type="button" onClick={generate} disabled={busy}>
        {busy ? "Generando…" : "Generar factura de ejemplo"}
      </Button>
      {busy ? (
        <output className="block text-sm" aria-live="polite">
          Preparando tu ejemplo…
        </output>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {url ? (
        <div className="space-y-3">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-sm underline"
          >
            Abrir el ejemplo en una pestaña nueva
          </a>
          <Button type="button" variant="outline" onClick={onDone}>
            Me gusta, continuar
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Setup wizard (FR-048): resumable, every step optional except fiscal data. */
export function OnboardingWizard() {
  const router = useRouter();
  const [company, setCompany] = useState<WizardCompany | null>(null);
  const [selected, setSelected] = useState<OnboardingStep | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const loaded = await apiRequest<WizardCompany>("/api/v1/company");
      setCompany(loaded);
      setSelected(
        (current) =>
          current ?? loaded.onboarding.currentStep ?? "sample_invoice",
      );
    } catch {
      setError("No se ha podido cargar la configuración.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function record(
    action: { complete: OnboardingStep } | { skip: OnboardingStep },
  ) {
    setError(null);
    try {
      const progress = await apiRequest<OnboardingProgress>(
        "/api/v1/company/onboarding",
        jsonRequest("PATCH", action),
      );
      setCompany((current) =>
        current ? { ...current, onboarding: progress } : current,
      );
      const stepKey = "complete" in action ? action.complete : action.skip;
      const order = progress.steps.map((entry) => entry.step);
      const after = order.slice(order.indexOf(stepKey) + 1);
      const next =
        progress.steps.find(
          (entry) => after.includes(entry.step) && entry.status === "pending",
        )?.step ?? progress.currentStep;
      setSelected(next ?? stepKey);
      router.refresh();
    } catch {
      setError("No se ha podido guardar el paso. Inténtalo de nuevo.");
    }
  }

  if (error && !company) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  }
  if (!company || !selected) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  const progress = company.onboarding;
  const entry = progress.steps.find((step) => step.step === selected);
  const index = progress.steps.findIndex((step) => step.step === selected);

  if (progress.finished) {
    return (
      <section
        aria-labelledby="onboarding-done-title"
        className="space-y-4 rounded-xl border bg-card p-6 shadow-sm"
      >
        <h2 id="onboarding-done-title" className="text-xl font-semibold">
          ¡Todo listo!
        </h2>
        <p className="text-sm text-muted-foreground">
          Ya puedes emitir tu primera factura.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/documents/new?type=invoice">
              Crear mi primera factura
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard">Ir al inicio</Link>
          </Button>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="text-sm font-medium" aria-live="polite">
          {progress.label ?? `Paso ${index + 1} de ${progress.total}`}
        </p>
        <StepList
          progress={progress}
          selected={selected}
          onSelect={setSelected}
        />
      </div>

      <section
        aria-labelledby="wizard-step-title"
        className="space-y-5 rounded-xl border bg-card p-5 shadow-sm sm:p-6"
      >
        <h2 id="wizard-step-title" className="text-xl font-semibold">
          {STEP_TITLES[selected]}
        </h2>

        {selected === "fiscal_data" ? (
          <CompanyProfileForm
            company={company}
            onChange={() => void load().then(() => router.refresh())}
          />
        ) : null}
        {selected === "logo" ? (
          <LogoSettings
            logoKey={company.logo_key}
            onChange={() => void load().then(() => router.refresh())}
          />
        ) : null}
        {selected === "collection_method" ? <CollectionMethodSettings /> : null}
        {selected === "series" ? (
          <p className="text-sm text-muted-foreground">
            Tus facturas se numeran solas, sin saltos, empezando por la serie
            por defecto. El número se reserva únicamente al emitir. Si necesitas
            otro prefijo o continuar una numeración anterior, cámbialo en{" "}
            <Link className="underline" href="/settings">
              Ajustes
            </Link>{" "}
            antes de emitir.
          </p>
        ) : null}
        {selected === "sample_invoice" ? (
          <SampleStep
            onDone={() => void record({ complete: "sample_invoice" })}
          />
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          {selected !== "sample_invoice" ? (
            <Button
              type="button"
              onClick={() => void record({ complete: selected })}
              disabled={selected === "fiscal_data" && entry?.status !== "done"}
            >
              {entry?.status === "done" ? "Continuar" : "Marcar como hecho"}
            </Button>
          ) : null}
          {entry?.status !== "done" ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void record({ skip: selected })}
            >
              Omitir este paso
            </Button>
          ) : null}
          <Button asChild variant="ghost">
            {/* Full navigation: the shell (banner progress) must be read fresh. */}
            <a href="/dashboard">Cerrar y seguir luego</a>
          </Button>
        </div>
      </section>
    </div>
  );
}

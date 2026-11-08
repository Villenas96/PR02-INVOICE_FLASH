"use client";

import { useEffect, useState } from "react";

import { useMutation } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, jsonRequest } from "@/lib/api/client";

/** Destination of manual and scheduled sends (FR-032, FR-034). */
export function AdvisorEmailForm({
  initialEmail,
  onSaved,
}: {
  initialEmail: string | null;
  onSaved: (email: string | null) => void;
}) {
  const [email, setEmail] = useState(initialEmail ?? "");
  const action = useMutation<{ advisor_email: string | null }>();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await action.run(() =>
      apiRequest<{ advisor_email: string | null }>(
        "/api/v1/company",
        jsonRequest("PUT", { advisor_email: email.trim() || null }),
      ),
    );
    if (saved) {
      onSaved(saved.advisor_email);
    }
  }

  return (
    <form
      id="advisor-email"
      onSubmit={handleSubmit}
      aria-labelledby="advisor-email-title"
      className="space-y-4 rounded-xl border bg-card p-5 shadow-sm sm:p-6"
    >
      <h2 id="advisor-email-title" className="text-lg font-semibold">
        Email de tu asesoría
      </h2>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label htmlFor="advisor-email-input">Email</Label>
          <Input
            id="advisor-email-input"
            type="email"
            maxLength={320}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="gestoria@ejemplo.es"
          />
        </div>
        <Button type="submit" disabled={action.isLoading}>
          {action.isLoading ? "Guardando…" : "Guardar"}
        </Button>
      </div>
      {action.error ? (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      ) : action.status === "success" ? (
        <output className="block text-sm">Email guardado.</output>
      ) : null}
    </form>
  );
}

interface Schedule {
  frequency: "monthly" | "quarterly";
  formats: Array<"xlsx" | "pdf_zip">;
  enabled: boolean;
  last_period_key: string | null;
}

/** Pro (FR-034): automatic monthly or quarterly package for the advisor. */
export function AdvisorScheduleForm({
  hasAdvisorEmail,
}: {
  hasAdvisorEmail: boolean;
}) {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const action = useMutation<Schedule>();

  useEffect(() => {
    apiRequest<Schedule>("/api/v1/advisor-schedule")
      .then(setSchedule)
      .catch(() => setSchedule(null));
  }, []);

  if (!schedule) {
    return null;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!schedule) {
      return;
    }
    const saved = await action.run(() =>
      apiRequest<Schedule>(
        "/api/v1/advisor-schedule",
        jsonRequest("PUT", {
          frequency: schedule.frequency,
          formats: schedule.formats,
          enabled: schedule.enabled,
        }),
      ),
    );
    if (saved) {
      setSchedule(saved);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-labelledby="advisor-schedule-title"
      className="space-y-4 rounded-xl border bg-card p-5 shadow-sm sm:p-6"
    >
      <div className="space-y-1">
        <h2 id="advisor-schedule-title" className="text-lg font-semibold">
          Envío automático a la asesoría
        </h2>
        <p className="text-sm text-muted-foreground">
          El primer día de cada mes o trimestre enviamos el periodo cerrado a tu
          asesoría con un enlace que caduca a los 7 días.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={schedule.enabled}
          disabled={!hasAdvisorEmail}
          onChange={(event) =>
            setSchedule({ ...schedule, enabled: event.target.checked })
          }
        />
        Activar el envío automático
      </label>
      {!hasAdvisorEmail ? (
        <p className="text-xs text-muted-foreground">
          Guarda primero el email de tu asesoría.
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="advisor-schedule-frequency">Frecuencia</Label>
          <select
            id="advisor-schedule-frequency"
            className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            value={schedule.frequency}
            onChange={(event) =>
              setSchedule({
                ...schedule,
                frequency: event.target.value as Schedule["frequency"],
              })
            }
          >
            <option value="quarterly">Trimestral</option>
            <option value="monthly">Mensual</option>
          </select>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Incluir</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked disabled />
            Excel del periodo
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={schedule.formats.includes("pdf_zip")}
              onChange={(event) =>
                setSchedule({
                  ...schedule,
                  formats: event.target.checked
                    ? ["xlsx", "pdf_zip"]
                    : ["xlsx"],
                })
              }
            />
            PDF de las facturas (ZIP)
          </label>
        </fieldset>
      </div>
      {schedule.last_period_key ? (
        <p className="text-xs text-muted-foreground">
          Último envío: {schedule.last_period_key}.
        </p>
      ) : null}
      {action.error ? (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      ) : action.status === "success" ? (
        <output className="block text-sm">Envío automático guardado.</output>
      ) : null}
      <Button type="submit" disabled={action.isLoading}>
        {action.isLoading ? "Guardando…" : "Guardar"}
      </Button>
    </form>
  );
}

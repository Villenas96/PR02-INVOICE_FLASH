"use client";

import { useState } from "react";

import { FeatureUpsell } from "@/components/plan/feature-upsell";
import { useMutation } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, jsonRequest } from "@/lib/api/client";
import { DISABLED_POLICY, type ReminderPolicy } from "@/lib/reminders";

/**
 * Automatic payment reminders (Pro, FR-041): when to remind and how many
 * times at most. At most one per invoice and day; they stop on payment.
 */
export function ReminderSettings({
  enabledForPlan,
  initialPolicy,
}: {
  enabledForPlan: boolean;
  initialPolicy: ReminderPolicy | undefined;
}) {
  const policy = initialPolicy ?? DISABLED_POLICY;
  const [enabled, setEnabled] = useState(policy.enabled);
  const [daysBefore, setDaysBefore] = useState(
    policy.days_before != null ? String(policy.days_before) : "",
  );
  const [onDue, setOnDue] = useState(policy.on_due ?? true);
  const [everyDaysAfter, setEveryDaysAfter] = useState(
    policy.every_days_after != null ? String(policy.every_days_after) : "7",
  );
  const [maxCount, setMaxCount] = useState(String(policy.max_count ?? 3));
  const save = useMutation<unknown>();

  if (!enabledForPlan) {
    return <FeatureUpsell feature="reminders" variant="inline" />;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await save.run(() =>
      apiRequest(
        "/api/v1/company",
        jsonRequest("PUT", {
          reminder_policy: enabled
            ? {
                enabled: true,
                days_before: daysBefore === "" ? null : Number(daysBefore),
                on_due: onDue,
                every_days_after:
                  everyDaysAfter === "" ? null : Number(everyDaysAfter),
                max_count: Number(maxCount),
              }
            : { enabled: false },
        }),
      ),
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-labelledby="reminder-title"
      className="space-y-4 rounded-xl border bg-card p-5 shadow-sm sm:p-6"
    >
      <div className="space-y-1">
        <h2 id="reminder-title" className="text-lg font-semibold">
          Recordatorios de pago
        </h2>
        <p className="text-sm text-muted-foreground">
          Enviamos un email a tus clientes con el importe pendiente y cómo
          pagar. Se detienen en cuanto registras el cobro y nunca hay más de uno
          por factura y día.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        Enviar recordatorios automáticos
      </label>
      {enabled ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="reminder-before">Días antes del vencimiento</Label>
            <Input
              id="reminder-before"
              type="number"
              min={1}
              max={30}
              placeholder="Ninguno"
              value={daysBefore}
              onChange={(event) => setDaysBefore(event.target.value)}
            />
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={onDue}
                onChange={(event) => setOnDue(event.target.checked)}
              />
              El día del vencimiento
            </label>
          </div>
          <div className="space-y-2">
            <Label htmlFor="reminder-after">
              Repetir cada (días) tras vencer
            </Label>
            <Input
              id="reminder-after"
              type="number"
              min={1}
              max={60}
              placeholder="No repetir"
              value={everyDaysAfter}
              onChange={(event) => setEveryDaysAfter(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reminder-max">Máximo de recordatorios</Label>
            <Input
              id="reminder-max"
              type="number"
              min={1}
              max={10}
              required
              value={maxCount}
              onChange={(event) => setMaxCount(event.target.value)}
            />
          </div>
        </div>
      ) : null}
      {save.error ? (
        <p role="alert" className="text-sm text-destructive">
          {save.error}
        </p>
      ) : save.status === "success" ? (
        <output className="block text-sm">Recordatorios guardados.</output>
      ) : null}
      <Button type="submit" disabled={save.isLoading}>
        {save.isLoading ? "Guardando…" : "Guardar"}
      </Button>
    </form>
  );
}

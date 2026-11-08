"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  ClientPicker,
  type SelectedClient,
} from "@/components/documents/editor/client-picker";
import type { EditorTaxRate } from "@/components/documents/editor/types";
import { useMutation } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, jsonRequest } from "@/lib/api/client";
import { parseEuroInput } from "@/lib/money";

import {
  ACTION_LABELS,
  FREQUENCY_LABELS,
  type Frequency,
  type RecurringTemplate,
} from "./types";

interface LineDraft {
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
}

const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function todayInMadrid(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(
    new Date(),
  );
}

function linesFrom(template: RecurringTemplate | undefined): LineDraft[] {
  return template
    ? template.lines.map((line) => ({
        description: line.description,
        quantity: String(Number(line.quantity)),
        unitPrice: (line.unit_price_cents / 100).toFixed(2).replace(".", ","),
        taxRate: line.tax_rate,
      }))
    : [{ description: "", quantity: "1", unitPrice: "", taxRate: "21.00" }];
}

/**
 * Create or edit a recurring template (FR-038, FR-040). Editing never
 * touches documents already generated: the new version applies to future
 * cycles only.
 */
export function RecurringForm({
  template,
  initialClient,
  onSaved,
}: {
  template?: RecurringTemplate;
  initialClient?: SelectedClient | null;
  /** Called after saving instead of navigating (edit in place). */
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [client, setClient] = useState<SelectedClient | null>(
    initialClient ?? null,
  );
  const [taxRates, setTaxRates] = useState<EditorTaxRate[]>([]);
  const [lines, setLines] = useState<LineDraft[]>(() => linesFrom(template));
  const [frequency, setFrequency] = useState<Frequency>(
    template?.frequency ?? "monthly",
  );
  const [intervalCount, setIntervalCount] = useState(
    String(template?.interval_count ?? 1),
  );
  const [intervalUnit, setIntervalUnit] = useState(
    template?.interval_unit ?? "month",
  );
  const [startOn, setStartOn] = useState(template?.start_on ?? todayInMadrid());
  const [endMode, setEndMode] = useState<"none" | "date" | "cycles">(
    template?.end_on ? "date" : template?.max_cycles ? "cycles" : "none",
  );
  const [endOn, setEndOn] = useState(template?.end_on ?? "");
  const [maxCycles, setMaxCycles] = useState(
    String(template?.max_cycles ?? 12),
  );
  const [action, setAction] = useState(template?.action ?? "draft");
  const [dueDays, setDueDays] = useState(String(template?.due_days ?? 30));
  const [notes, setNotes] = useState(template?.notes ?? "");
  const save = useMutation<{ id: string }>();

  useEffect(() => {
    apiRequest<{ items: EditorTaxRate[] }>("/api/v1/tax-rates")
      .then((page) => setTaxRates(page.items))
      .catch(() => setTaxRates([]));
  }, []);

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((current) =>
      current.map((line, position) =>
        position === index ? { ...line, ...patch } : line,
      ),
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = {
      client_id: client?.id,
      lines: lines.map((line) => ({
        description: line.description.trim(),
        quantity: line.quantity.replace(",", "."),
        unit_price_cents: parseEuroInput(line.unitPrice),
        tax_rate: line.taxRate,
      })),
      notes: notes.trim() || null,
      due_days: Number(dueDays),
      frequency,
      interval_count: frequency === "custom" ? Number(intervalCount) : null,
      interval_unit: frequency === "custom" ? intervalUnit : null,
      ...(template ? {} : { start_on: startOn }),
      end_on: endMode === "date" ? endOn : null,
      max_cycles: endMode === "cycles" ? Number(maxCycles) : null,
      action,
    };
    const saved = await save.run(() =>
      apiRequest<{ id: string }>(
        template
          ? `/api/v1/recurring-templates/${template.id}`
          : "/api/v1/recurring-templates",
        jsonRequest(template ? "PATCH" : "POST", body),
      ),
    );
    if (saved) {
      if (onSaved) {
        onSaved();
      } else {
        router.push(`/recurring/${saved.id}`);
      }
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-6 rounded-xl border bg-card p-5 shadow-sm sm:p-6"
      aria-label={template ? "Editar recurrencia" : "Nueva recurrencia"}
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <ClientPicker value={client} onChange={setClient} />
        <div className="space-y-2">
          <Label htmlFor="recurring-action">Cada vez que toca</Label>
          <select
            id="recurring-action"
            className={SELECT_CLASS}
            value={action}
            onChange={(event) =>
              setAction(event.target.value as RecurringTemplate["action"])
            }
          >
            {Object.entries(ACTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="recurring-frequency">Periodicidad</Label>
          <select
            id="recurring-frequency"
            className={SELECT_CLASS}
            value={frequency}
            onChange={(event) => setFrequency(event.target.value as Frequency)}
          >
            {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {frequency === "custom" ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="recurring-interval">Cada</Label>
              <Input
                id="recurring-interval"
                type="number"
                min={1}
                max={365}
                required
                value={intervalCount}
                onChange={(event) => setIntervalCount(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="recurring-unit">Unidad</Label>
              <select
                id="recurring-unit"
                className={SELECT_CLASS}
                value={intervalUnit}
                onChange={(event) =>
                  setIntervalUnit(
                    event.target.value as "day" | "week" | "month",
                  )
                }
              >
                <option value="day">días</option>
                <option value="week">semanas</option>
                <option value="month">meses</option>
              </select>
            </div>
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="recurring-start">Primera fecha</Label>
          <Input
            id="recurring-start"
            type="date"
            required
            disabled={Boolean(template)}
            min={template ? undefined : todayInMadrid()}
            value={startOn}
            onChange={(event) => setStartOn(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="recurring-end-mode">Final</Label>
          <select
            id="recurring-end-mode"
            className={SELECT_CLASS}
            value={endMode}
            onChange={(event) =>
              setEndMode(event.target.value as "none" | "date" | "cycles")
            }
          >
            <option value="none">Sin final</option>
            <option value="date">En una fecha</option>
            <option value="cycles">Tras un número de ciclos</option>
          </select>
        </div>
        {endMode === "date" ? (
          <div className="space-y-2">
            <Label htmlFor="recurring-end-date">Hasta</Label>
            <Input
              id="recurring-end-date"
              type="date"
              required
              min={startOn}
              value={endOn}
              onChange={(event) => setEndOn(event.target.value)}
            />
          </div>
        ) : null}
        {endMode === "cycles" ? (
          <div className="space-y-2">
            <Label htmlFor="recurring-cycles">Número de ciclos</Label>
            <Input
              id="recurring-cycles"
              type="number"
              min={1}
              max={1000}
              required
              value={maxCycles}
              onChange={(event) => setMaxCycles(event.target.value)}
            />
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="recurring-due-days">Días hasta el vencimiento</Label>
          <Input
            id="recurring-due-days"
            type="number"
            min={0}
            max={3650}
            required
            value={dueDays}
            onChange={(event) => setDueDays(event.target.value)}
          />
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Líneas</legend>
        {lines.map((line, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: lines have no id until saved and are only appended/removed at the end.
            key={index}
            className="grid gap-3 sm:grid-cols-[1fr_6rem_8rem_9rem_auto]"
          >
            <div className="space-y-1">
              <Label htmlFor={`line-description-${index}`}>Descripción</Label>
              <Input
                id={`line-description-${index}`}
                required
                maxLength={1000}
                value={line.description}
                onChange={(event) =>
                  updateLine(index, { description: event.target.value })
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`line-quantity-${index}`}>Cantidad</Label>
              <Input
                id={`line-quantity-${index}`}
                required
                inputMode="decimal"
                value={line.quantity}
                onChange={(event) =>
                  updateLine(index, { quantity: event.target.value })
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`line-price-${index}`}>Precio (€)</Label>
              <Input
                id={`line-price-${index}`}
                required
                inputMode="decimal"
                value={line.unitPrice}
                onChange={(event) =>
                  updateLine(index, { unitPrice: event.target.value })
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`line-tax-${index}`}>Impuesto</Label>
              <select
                id={`line-tax-${index}`}
                className={SELECT_CLASS}
                value={line.taxRate}
                onChange={(event) =>
                  updateLine(index, { taxRate: event.target.value })
                }
              >
                {(taxRates.length > 0
                  ? taxRates
                  : [
                      {
                        id: "iva",
                        name: "IVA",
                        rate: "21.00",
                        is_default: true,
                      },
                    ]
                ).map((tax) => (
                  <option key={tax.id} value={tax.rate}>
                    {tax.name} {Number(tax.rate).toLocaleString("es-ES")} %
                  </option>
                ))}
              </select>
            </div>
            {lines.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                className="self-end"
                onClick={() =>
                  setLines((current) =>
                    current.filter((_, position) => position !== index),
                  )
                }
              >
                Quitar<span className="sr-only"> línea {index + 1}</span>
              </Button>
            ) : null}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setLines((current) => [
              ...current,
              {
                description: "",
                quantity: "1",
                unitPrice: "",
                taxRate: "21.00",
              },
            ])
          }
        >
          Añadir línea
        </Button>
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="recurring-notes">Observaciones</Label>
        <Input
          id="recurring-notes"
          maxLength={5000}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>

      {template ? (
        <p className="text-sm text-muted-foreground">
          Los cambios solo afectan a los próximos ciclos; los documentos ya
          generados no se modifican.
        </p>
      ) : null}
      {save.error ? (
        <p role="alert" className="text-sm text-destructive">
          {save.error}
        </p>
      ) : null}
      <Button type="submit" disabled={save.isLoading || !client}>
        {save.isLoading
          ? "Guardando…"
          : template
            ? "Guardar cambios"
            : "Crear recurrencia"}
      </Button>
    </form>
  );
}

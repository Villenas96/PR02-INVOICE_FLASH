"use client";

import { useState } from "react";

import {
  type CatalogItemResponse,
  type CatalogItemSelection,
  CatalogPicker,
  selectionFrom,
} from "@/components/documents/editor/catalog-picker";
import { useMutation } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, jsonRequest } from "@/lib/api/client";
import type { BillingResult } from "@/lib/billing";
import { createCents, formatEur, parseEuroInput } from "@/lib/money";

import type { EditorLine, EditorTaxRate } from "./types";

interface InvoiceLinesProps {
  lines: EditorLine[];
  calculation?: BillingResult;
  taxRates: EditorTaxRate[];
  units: string[];
  onUnitCreated: (unit: string) => void;
  onChange: (lines: EditorLine[]) => void;
}

function defaultTax(taxRates: EditorTaxRate[]): EditorTaxRate | undefined {
  return taxRates.find((rate) => rate.is_default) ?? taxRates[0];
}

export function emptyLine(taxRates: EditorTaxRate[] = []): EditorLine {
  const tax = defaultTax(taxRates);
  return {
    localId: crypto.randomUUID(),
    description: "",
    quantity: "1",
    unitPrice: "0,00",
    taxRate: tax?.rate ?? "",
    taxName: tax?.name ?? "IVA",
    taxRateId: tax?.id ?? null,
    unit: "",
    catalogItemId: null,
    discountPercentage: "0",
  };
}

export function createInitialEditorLine(): EditorLine {
  return emptyLine();
}

function taxLabel(tax: { name: string; rate: string }): string {
  return `${tax.name} ${Number(tax.rate).toLocaleString("es-ES")} %`;
}

function lineFromCatalogItem(
  item: CatalogItemSelection,
  taxRates: EditorTaxRate[],
): EditorLine {
  const tax =
    taxRates.find((rate) => rate.id === item.taxRateId) ??
    taxRates.find((rate) => rate.rate === item.taxRate);
  return {
    localId: crypto.randomUUID(),
    description: item.description,
    quantity: "1",
    unitPrice: (item.unitPriceCents / 100).toFixed(2).replace(".", ","),
    taxRate: tax?.rate ?? item.taxRate,
    taxName: tax?.name ?? "IVA",
    taxRateId: tax?.id ?? null,
    unit: item.unit ?? "",
    catalogItemId: item.id,
    discountPercentage: "0",
  };
}

/** Saves a manual line as a catalog product and links it (US4-AC2). */
function SaveToCatalogButton({
  line,
  onSaved,
}: {
  line: EditorLine;
  onSaved: (item: CatalogItemSelection) => void;
}) {
  const action = useMutation<CatalogItemResponse>({ refresh: false });

  async function save() {
    const created = await action.run(() =>
      apiRequest<CatalogItemResponse>(
        "/api/v1/catalog-items",
        jsonRequest("POST", {
          description: line.description.trim(),
          unit_price_cents: parseEuroInput(line.unitPrice),
          ...(line.taxRateId
            ? { tax_rate_id: line.taxRateId }
            : { tax_rate: line.taxRate }),
          unit: line.unit.trim() || null,
        }),
      ),
    );
    if (created) {
      onSaved(selectionFrom(created));
    }
  }

  return (
    <div className="space-y-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={action.isLoading || line.description.trim() === ""}
        onClick={save}
      >
        {action.isLoading ? "Guardando…" : "Guardar en catálogo"}
      </Button>
      {action.error ? (
        <p role="alert" className="text-xs text-destructive">
          {action.error}
        </p>
      ) : null}
    </div>
  );
}

export function InvoiceLines({
  lines,
  calculation,
  taxRates,
  units,
  onUnitCreated,
  onChange,
}: InvoiceLinesProps) {
  const [unitError, setUnitError] = useState<string>();

  function updateLine(localId: string, change: Partial<EditorLine>) {
    onChange(
      lines.map((line) =>
        line.localId === localId ? { ...line, ...change } : line,
      ),
    );
  }

  function removeLine(localId: string) {
    if (lines.length === 1) {
      onChange([emptyLine(taxRates)]);
      return;
    }
    onChange(lines.filter((line) => line.localId !== localId));
  }

  async function createUnit(localId: string, name: string) {
    try {
      const created = await apiRequest<{ name: string }>(
        "/api/v1/units",
        jsonRequest("POST", { name }),
      );
      onUnitCreated(created.name);
      updateLine(localId, { unit: created.name });
      setUnitError(undefined);
    } catch (error) {
      setUnitError(
        error instanceof Error ? error.message : "No se ha podido crear.",
      );
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="invoice-lines-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="invoice-lines-title" className="font-semibold">
            Conceptos
          </h2>
          <p className="text-sm text-muted-foreground">
            Los importes se calculan y redondean por línea.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <CatalogPicker
            taxRates={taxRates}
            onSelect={(item) => {
              // Replace the untouched initial line instead of leaving it
              // empty above the product.
              const kept = lines.filter(
                (line) => line.description.trim() !== "" || lines.length > 1,
              );
              onChange([...kept, lineFromCatalogItem(item, taxRates)]);
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => onChange([...lines, emptyLine(taxRates)])}
          >
            Añadir línea
          </Button>
        </div>
      </div>

      {unitError ? (
        <p role="alert" className="text-sm text-destructive">
          {unitError}
        </p>
      ) : null}

      <div className="space-y-3">
        {lines.map((line, index) => {
          const lineResult = calculation?.lines[index];
          const selectedTax =
            taxRates.find((rate) => rate.id === line.taxRateId) ??
            (line.taxRate
              ? {
                  id: `legacy-${line.taxName}-${line.taxRate}`,
                  name: line.taxName,
                  rate: line.taxRate,
                  is_default: false,
                }
              : null);
          return (
            <fieldset
              key={line.localId}
              className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[minmax(12rem,1fr)_6rem_7rem_8rem_10rem_6rem_7rem_auto]"
            >
              <legend className="sr-only">Línea {index + 1}</legend>
              <div className="space-y-2 sm:col-span-2 lg:col-span-1">
                <Label htmlFor={`description-${line.localId}`}>
                  Descripción
                </Label>
                <Input
                  id={`description-${line.localId}`}
                  maxLength={1000}
                  placeholder="Servicio prestado"
                  value={line.description}
                  onChange={(event) =>
                    updateLine(line.localId, {
                      description: event.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`quantity-${line.localId}`}>Cantidad</Label>
                <Input
                  id={`quantity-${line.localId}`}
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(event) =>
                    updateLine(line.localId, {
                      quantity: event.target.value.replace(",", "."),
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label id={`unit-label-${line.localId}`}>Unidad</Label>
                <Combobox<string>
                  aria-labelledby={`unit-label-${line.localId}`}
                  value={line.unit || null}
                  onChange={(unit) =>
                    updateLine(line.localId, { unit: unit ?? "" })
                  }
                  getKey={(unit) => unit}
                  getLabel={(unit) => unit}
                  options={units}
                  onCreate={(name) => createUnit(line.localId, name)}
                  clearLabel="Sin unidad"
                  placeholder="—"
                  searchPlaceholder="Buscar unidad"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`price-${line.localId}`}>Precio unitario</Label>
                <Input
                  id={`price-${line.localId}`}
                  inputMode="decimal"
                  value={line.unitPrice}
                  onChange={(event) =>
                    updateLine(line.localId, {
                      unitPrice: event.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label id={`tax-label-${line.localId}`}>Impuesto</Label>
                <Combobox<EditorTaxRate>
                  aria-labelledby={`tax-label-${line.localId}`}
                  value={selectedTax}
                  onChange={(tax) => {
                    if (tax) {
                      updateLine(line.localId, {
                        taxRateId: tax.id,
                        taxName: tax.name,
                        taxRate: tax.rate,
                      });
                    }
                  }}
                  getKey={(tax) => tax.id}
                  getLabel={taxLabel}
                  options={taxRates}
                  placeholder="—"
                  searchPlaceholder="Buscar impuesto"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`discount-${line.localId}`}>Descuento</Label>
                <div className="flex items-center gap-1">
                  <Input
                    id={`discount-${line.localId}`}
                    inputMode="decimal"
                    value={line.discountPercentage}
                    onChange={(event) =>
                      updateLine(line.localId, {
                        discountPercentage: event.target.value.replace(
                          ",",
                          ".",
                        ),
                      })
                    }
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>
              <div className="space-y-2">
                <span className="block text-sm font-medium">Importe</span>
                <output className="flex h-8 items-center text-sm font-semibold">
                  {lineResult
                    ? formatEur(createCents(lineResult.totalCents))
                    : "—"}
                </output>
              </div>
              <div className="flex flex-wrap items-end justify-end gap-2 sm:col-span-2 lg:col-span-1">
                {line.catalogItemId === null ? (
                  <SaveToCatalogButton
                    line={line}
                    onSaved={(item) =>
                      updateLine(line.localId, { catalogItemId: item.id })
                    }
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">
                    En catálogo
                  </span>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => removeLine(line.localId)}
                >
                  Quitar
                  <span className="sr-only"> línea {index + 1}</span>
                </Button>
              </div>
            </fieldset>
          );
        })}
      </div>
    </section>
  );
}

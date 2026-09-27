"use client";

import {
  type CatalogItemSelection,
  CatalogPicker,
} from "@/components/documents/editor/catalog-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BillingResult } from "@/lib/billing";
import { createCents, formatEur } from "@/lib/money";

import type { EditorLine } from "./types";

interface InvoiceLinesProps {
  lines: EditorLine[];
  calculation?: BillingResult;
  defaultTaxRate: string;
  onChange: (lines: EditorLine[]) => void;
}

function emptyLine(defaultTaxRate: string): EditorLine {
  return {
    localId: crypto.randomUUID(),
    description: "",
    quantity: "1",
    unitPrice: "0,00",
    taxRate: defaultTaxRate,
    discountPercentage: "0",
  };
}

export function createInitialEditorLine(): EditorLine {
  return emptyLine("");
}

function lineFromCatalogItem(item: CatalogItemSelection): EditorLine {
  return {
    localId: crypto.randomUUID(),
    description: item.description,
    quantity: "1",
    unitPrice: (item.unitPriceCents / 100).toFixed(2).replace(".", ","),
    taxRate: item.taxRate,
    discountPercentage: "0",
  };
}

export function InvoiceLines({
  lines,
  calculation,
  defaultTaxRate,
  onChange,
}: InvoiceLinesProps) {
  function updateLine(localId: string, change: Partial<EditorLine>) {
    onChange(
      lines.map((line) =>
        line.localId === localId ? { ...line, ...change } : line,
      ),
    );
  }

  function removeLine(localId: string) {
    if (lines.length === 1) {
      onChange([emptyLine(defaultTaxRate)]);
      return;
    }
    onChange(lines.filter((line) => line.localId !== localId));
  }

  return (
    <section className="space-y-4" aria-labelledby="invoice-lines-title">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 id="invoice-lines-title" className="font-semibold">
            Conceptos
          </h2>
          <p className="text-sm text-muted-foreground">
            Los importes se calculan y redondean por línea.
          </p>
        </div>
        <div className="flex gap-2">
          <CatalogPicker
            onSelect={(item) => onChange([...lines, lineFromCatalogItem(item)])}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => onChange([...lines, emptyLine(defaultTaxRate)])}
          >
            Añadir línea
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {lines.map((line, index) => {
          const lineResult = calculation?.lines[index];
          return (
            <fieldset
              key={line.localId}
              className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[minmax(12rem,1fr)_7rem_9rem_7rem_7rem_8rem_auto]"
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
                <Label htmlFor={`tax-${line.localId}`}>IVA</Label>
                <select
                  id={`tax-${line.localId}`}
                  className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  value={line.taxRate}
                  onChange={(event) =>
                    updateLine(line.localId, { taxRate: event.target.value })
                  }
                >
                  <option value="" disabled>
                    —
                  </option>
                  <option value="0.00">0 %</option>
                  <option value="4.00">4 %</option>
                  <option value="10.00">10 %</option>
                  <option value="21.00">21 %</option>
                </select>
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
              <div className="flex items-end justify-end">
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

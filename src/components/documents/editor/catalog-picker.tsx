"use client";

import { useState } from "react";

import { useMutation } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxPage } from "@/components/ui/combobox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, jsonRequest } from "@/lib/api/client";
import { createCents, formatEur, parseEuroInput } from "@/lib/money";

import type { EditorTaxRate } from "./types";

export interface CatalogItemSelection {
  id: string;
  description: string;
  unitPriceCents: number;
  taxRate: string;
  taxRateId: string | null;
  unit: string | null;
}

export interface CatalogItemResponse {
  id: string;
  description: string;
  unit_price_cents: number;
  tax_rate: string;
  tax_rate_id: string | null;
  unit: string | null;
}

export function selectionFrom(item: CatalogItemResponse): CatalogItemSelection {
  return {
    id: item.id,
    description: item.description,
    unitPriceCents: item.unit_price_cents,
    taxRate: item.tax_rate,
    taxRateId: item.tax_rate_id,
    unit: item.unit,
  };
}

async function loadCatalogItems(
  query: string,
  cursor: string | null,
  signal: AbortSignal,
): Promise<ComboboxPage<CatalogItemSelection>> {
  const params = new URLSearchParams({ limit: "25" });
  if (query.trim()) {
    params.set("q", query.trim());
  }
  if (cursor) {
    params.set("cursor", cursor);
  }
  const page = await apiRequest<{
    items: CatalogItemResponse[];
    next_cursor: string | null;
  }>(`/api/v1/catalog-items?${params.toString()}`, { signal });
  return { items: page.items.map(selectionFrom), nextCursor: page.next_cursor };
}

function InlineProductForm({
  initialDescription,
  taxRates,
  onCreated,
}: {
  initialDescription: string;
  taxRates: EditorTaxRate[];
  onCreated: (item: CatalogItemSelection) => void;
}) {
  const [description, setDescription] = useState(initialDescription);
  const [price, setPrice] = useState("0,00");
  const [taxRateId, setTaxRateId] = useState(
    (taxRates.find((rate) => rate.is_default) ?? taxRates[0])?.id ?? "",
  );
  const action = useMutation<CatalogItemResponse>();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await action.run(() =>
      apiRequest<CatalogItemResponse>(
        "/api/v1/catalog-items",
        jsonRequest("POST", {
          description: description.trim(),
          unit_price_cents: parseEuroInput(price),
          ...(taxRateId ? { tax_rate_id: taxRateId } : {}),
        }),
      ),
    );
    if (created) {
      onCreated(selectionFrom(created));
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>Nuevo producto</DialogTitle>
        <DialogDescription>
          Se guardará en tu catálogo y se añadirá como línea de este documento.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="space-y-2">
          <Label htmlFor="inline-product-description">Descripción</Label>
          <Input
            id="inline-product-description"
            required
            autoFocus
            maxLength={1000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="inline-product-price">Precio unitario</Label>
            <Input
              id="inline-product-price"
              inputMode="decimal"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inline-product-tax">Impuesto</Label>
            <select
              id="inline-product-tax"
              className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={taxRateId}
              onChange={(event) => setTaxRateId(event.target.value)}
            >
              {taxRates.map((rate) => (
                <option key={rate.id} value={rate.id}>
                  {rate.name} {Number(rate.rate).toLocaleString("es-ES")} %
                </option>
              ))}
            </select>
          </div>
        </div>
        {action.error ? (
          <p role="alert" className="text-sm text-destructive">
            {action.error}
          </p>
        ) : null}
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={action.isLoading}>
            Cancelar
          </Button>
        </DialogClose>
        <Button type="submit" disabled={action.isLoading}>
          {action.isLoading ? "Guardando…" : "Crear producto"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Adds a catalog product as a new line, searching as the user types, or
 * creates the product inline without leaving the editor (FR-014, FR-015).
 * Values are copied into the line: later catalog edits never change it.
 */
export function CatalogPicker({
  taxRates,
  onSelect,
}: {
  taxRates: EditorTaxRate[];
  onSelect: (item: CatalogItemSelection) => void;
}) {
  const [createDescription, setCreateDescription] = useState<string | null>(
    null,
  );

  return (
    <>
      <Combobox<CatalogItemSelection>
        aria-label="Añadir producto del catálogo"
        className="sm:w-72"
        value={null}
        onChange={(item) => {
          if (item) {
            onSelect(item);
          }
        }}
        getKey={(item) => item.id}
        getLabel={(item) => item.description}
        getDescription={(item) =>
          `${formatEur(createCents(item.unitPriceCents))} · IVA ${Number(item.taxRate).toLocaleString("es-ES")} %`
        }
        loadOptions={loadCatalogItems}
        onCreate={(query) => setCreateDescription(query)}
        placeholder="Añadir producto del catálogo"
        searchPlaceholder="Buscar producto"
        emptyMessage="No hay productos que coincidan."
      />
      <Dialog
        open={createDescription !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreateDescription(null);
          }
        }}
      >
        <DialogContent>
          {createDescription !== null ? (
            <InlineProductForm
              key={createDescription}
              initialDescription={createDescription}
              taxRates={taxRates}
              onCreated={(item) => {
                onSelect(item);
                setCreateDescription(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/api/client";
import { createCents, formatEur } from "@/lib/money";

const SEARCH_DEBOUNCE_MS = 250;

export interface CatalogItemSelection {
  description: string;
  unitPriceCents: number;
  taxRate: string;
}

interface CatalogItemRow extends CatalogItemSelection {
  id: string;
}

/**
 * Copies the catalog item's current values into a new line; there is no
 * foreign key from `document_line` to `catalog_item`, so a later edit or
 * archive of the item never touches lines already added this way.
 */
export function CatalogPicker({
  onSelect,
}: {
  onSelect: (item: CatalogItemSelection) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CatalogItemRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const controller = new AbortController();
    const trimmed = query.trim();
    const timeout = setTimeout(
      () => {
        setIsLoading(true);
        const params = new URLSearchParams({ limit: "25" });
        if (trimmed) {
          params.set("q", trimmed);
        }
        apiRequest<{
          items: Array<{
            id: string;
            description: string;
            unit_price_cents: number;
            tax_rate: string;
          }>;
          next_cursor: string | null;
        }>(`/api/v1/catalog-items?${params.toString()}`, {
          signal: controller.signal,
        })
          .then((page) => {
            setItems(
              page.items.map((item) => ({
                id: item.id,
                description: item.description,
                unitPriceCents: item.unit_price_cents,
                taxRate: item.tax_rate,
              })),
            );
            setError(undefined);
          })
          .catch((loadError: unknown) => {
            if (
              loadError instanceof DOMException &&
              loadError.name === "AbortError"
            ) {
              return;
            }
            setError(
              loadError instanceof Error
                ? loadError.message
                : "No se han podido cargar los conceptos.",
            );
          })
          .finally(() => {
            if (!controller.signal.aborted) {
              setIsLoading(false);
            }
          });
      },
      trimmed ? SEARCH_DEBOUNCE_MS : 0,
    );

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [isOpen, query]);

  function handleSelect(item: CatalogItemRow) {
    onSelect({
      description: item.description,
      unitPriceCents: item.unitPriceCents,
      taxRate: item.taxRate,
    });
    setIsOpen(false);
    setQuery("");
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          Añadir desde catálogo
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Añadir desde catálogo</DialogTitle>
          <DialogDescription>
            Copia la descripción, el precio y el IVA del concepto en una nueva
            línea.
          </DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Buscar concepto"
          placeholder="Descripción"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
        />
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay conceptos con esta búsqueda.
            </p>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-transparent px-3 py-2 text-left text-sm hover:border-input hover:bg-muted"
                onClick={() => handleSelect(item)}
              >
                <span className="truncate">{item.description}</span>
                <span className="shrink-0 text-muted-foreground">
                  {formatEur(createCents(item.unitPriceCents))}
                </span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

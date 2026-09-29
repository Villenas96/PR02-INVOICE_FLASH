"use client";

import { useCallback, useEffect, useState } from "react";

import { useAsyncAction } from "@/components/ui/async-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiRequest, jsonRequest } from "@/lib/api/client";
import { createCents, formatEur, parseEuroInput } from "@/lib/money";

const SEARCH_DEBOUNCE_MS = 250;
const TAX_RATE_OPTIONS = ["0.00", "4.00", "10.00", "21.00"] as const;

interface CatalogItemData {
  id: string;
  description: string;
  unit_price_cents: number;
  tax_rate: string;
  archived_at: string | null;
}

interface CatalogItemPage {
  items: CatalogItemData[];
  next_cursor: string | null;
}

interface CatalogItemFormFields {
  description: string;
  unitPrice: string;
  taxRate: (typeof TAX_RATE_OPTIONS)[number];
}

function TaxRateSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: (typeof TAX_RATE_OPTIONS)[number]) => void;
}) {
  return (
    <select
      id={id}
      className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      value={value}
      onChange={(event) =>
        onChange(event.target.value as (typeof TAX_RATE_OPTIONS)[number])
      }
    >
      {TAX_RATE_OPTIONS.map((rate) => (
        <option key={rate} value={rate}>
          {Number(rate).toLocaleString("es-ES")} %
        </option>
      ))}
    </select>
  );
}

function CreateCatalogItemDialog({
  onCreated,
}: {
  onCreated: (item: CatalogItemData) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [fields, setFields] = useState<CatalogItemFormFields>({
    description: "",
    unitPrice: "",
    taxRate: "21.00",
  });
  const action = useAsyncAction<CatalogItemData>();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let unitPriceCents: number;
    try {
      unitPriceCents = parseEuroInput(fields.unitPrice);
    } catch {
      await action.run(() =>
        Promise.reject(
          new Error("Indica un precio válido con hasta dos decimales."),
        ),
      );
      return;
    }
    const created = await action.run(() =>
      apiRequest<CatalogItemData>(
        "/api/v1/catalog-items",
        jsonRequest("POST", {
          description: fields.description.trim(),
          unit_price_cents: unitPriceCents,
          tax_rate: fields.taxRate,
        }),
      ),
    );
    if (created) {
      onCreated(created);
      setIsOpen(false);
      setFields({ description: "", unitPrice: "", taxRate: "21.00" });
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button type="button">Nuevo concepto</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Nuevo concepto</DialogTitle>
            <DialogDescription>
              Guárdalo para añadirlo rápido a tus próximas facturas.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="new-catalog-description">Descripción</Label>
              <Input
                id="new-catalog-description"
                maxLength={1_000}
                required
                autoFocus
                value={fields.description}
                onChange={(event) =>
                  setFields({ ...fields, description: event.target.value })
                }
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new-catalog-price">Precio unitario</Label>
                <Input
                  id="new-catalog-price"
                  inputMode="decimal"
                  required
                  value={fields.unitPrice}
                  onChange={(event) =>
                    setFields({ ...fields, unitPrice: event.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-catalog-tax">IVA</Label>
                <TaxRateSelect
                  id="new-catalog-tax"
                  value={fields.taxRate}
                  onChange={(taxRate) => setFields({ ...fields, taxRate })}
                />
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
              <Button
                type="button"
                variant="outline"
                disabled={action.isLoading}
              >
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit" disabled={action.isLoading}>
              {action.isLoading ? "Guardando…" : "Crear concepto"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditCatalogItemDialog({
  item,
  onSaved,
}: {
  item: CatalogItemData;
  onSaved: (item: CatalogItemData) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [fields, setFields] = useState<CatalogItemFormFields>({
    description: item.description,
    unitPrice: (item.unit_price_cents / 100).toFixed(2).replace(".", ","),
    taxRate: item.tax_rate as (typeof TAX_RATE_OPTIONS)[number],
  });
  const action = useAsyncAction<CatalogItemData>();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let unitPriceCents: number;
    try {
      unitPriceCents = parseEuroInput(fields.unitPrice);
    } catch {
      await action.run(() =>
        Promise.reject(
          new Error("Indica un precio válido con hasta dos decimales."),
        ),
      );
      return;
    }
    const updated = await action.run(() =>
      apiRequest<CatalogItemData>(
        `/api/v1/catalog-items/${item.id}`,
        jsonRequest("PATCH", {
          description: fields.description.trim(),
          unit_price_cents: unitPriceCents,
          tax_rate: fields.taxRate,
        }),
      ),
    );
    if (updated) {
      onSaved(updated);
      setIsOpen(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          Editar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Editar concepto</DialogTitle>
            <DialogDescription>
              Las líneas ya guardadas en documentos conservan su valor copiado.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor={`edit-catalog-description-${item.id}`}>
                Descripción
              </Label>
              <Input
                id={`edit-catalog-description-${item.id}`}
                maxLength={1_000}
                required
                value={fields.description}
                onChange={(event) =>
                  setFields({ ...fields, description: event.target.value })
                }
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`edit-catalog-price-${item.id}`}>
                  Precio unitario
                </Label>
                <Input
                  id={`edit-catalog-price-${item.id}`}
                  inputMode="decimal"
                  required
                  value={fields.unitPrice}
                  onChange={(event) =>
                    setFields({ ...fields, unitPrice: event.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`edit-catalog-tax-${item.id}`}>IVA</Label>
                <TaxRateSelect
                  id={`edit-catalog-tax-${item.id}`}
                  value={fields.taxRate}
                  onChange={(taxRate) => setFields({ ...fields, taxRate })}
                />
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
              <Button
                type="button"
                variant="outline"
                disabled={action.isLoading}
              >
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit" disabled={action.isLoading}>
              {action.isLoading ? "Guardando…" : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveToggle({
  item,
  onChanged,
}: {
  item: CatalogItemData;
  onChanged: (item: CatalogItemData) => void;
}) {
  const action = useAsyncAction<CatalogItemData>();
  const isArchived = item.archived_at !== null;

  async function handleClick() {
    const updated = await action.run(() =>
      apiRequest<CatalogItemData>(
        isArchived
          ? `/api/v1/catalog-items/${item.id}/restore`
          : `/api/v1/catalog-items/${item.id}`,
        { method: isArchived ? "POST" : "DELETE" },
      ),
    );
    if (updated) {
      onChanged(updated);
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={action.isLoading}
      onClick={handleClick}
    >
      {action.isLoading ? "Guardando…" : isArchived ? "Restaurar" : "Archivar"}
    </Button>
  );
}

export function CatalogList() {
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [items, setItems] = useState<CatalogItemData[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string>();

  const queryPath = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams({ limit: "25" });
      if (query.trim()) {
        params.set("q", query.trim());
      }
      if (showArchived) {
        params.set("archived", "true");
      }
      if (cursor) {
        params.set("cursor", cursor);
      }
      return `/api/v1/catalog-items?${params.toString()}`;
    },
    [query, showArchived],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => {
        setIsLoading(true);
        setError(undefined);
        apiRequest<CatalogItemPage>(queryPath(), {
          signal: controller.signal,
        })
          .then((page) => {
            setItems(page.items);
            setNextCursor(page.next_cursor);
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
      query ? SEARCH_DEBOUNCE_MS : 0,
    );

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [queryPath, query]);

  async function loadMore() {
    if (!nextCursor || isLoadingMore) {
      return;
    }
    setIsLoadingMore(true);
    try {
      const page = await apiRequest<CatalogItemPage>(queryPath(nextCursor));
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.next_cursor);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se han podido cargar más conceptos.",
      );
    } finally {
      setIsLoadingMore(false);
    }
  }

  function replaceItem(updated: CatalogItemData) {
    setItems((current) =>
      showArchived === (updated.archived_at !== null)
        ? current.map((item) => (item.id === updated.id ? updated : item))
        : current.filter((item) => item.id !== updated.id),
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="catalog-search">Buscar</Label>
            <Input
              id="catalog-search"
              placeholder="Descripción"
              className="sm:w-64"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 pb-1.5 text-sm">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            Mostrar archivados
          </label>
        </div>
        <CreateCatalogItemDialog
          onCreated={(created) => setItems((current) => [created, ...current])}
        />
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p
            role="alert"
            className="text-sm text-[color-mix(in_oklch,var(--destructive),var(--foreground)_35%)]"
          >
            {error}
          </p>
        </div>
      ) : null}

      {isLoading ? (
        <output className="block h-64 animate-pulse rounded-xl border bg-muted/50">
          <span className="sr-only">Cargando conceptos…</span>
        </output>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-10 text-center">
          <h2 className="font-semibold">No hay conceptos con estos filtros</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Crea tu primer concepto para reutilizarlo en tus facturas.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descripción</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead className="text-right">IVA</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="max-w-sm whitespace-normal font-medium">
                    {item.description}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatEur(createCents(item.unit_price_cents))}
                  </TableCell>
                  <TableCell className="text-right">
                    {Number(item.tax_rate).toLocaleString("es-ES")} %
                  </TableCell>
                  <TableCell>
                    {item.archived_at ? (
                      <Badge variant="secondary">Archivado</Badge>
                    ) : (
                      <Badge variant="outline">Activo</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <EditCatalogItemDialog
                        item={item}
                        onSaved={replaceItem}
                      />
                      <ArchiveToggle item={item} onChanged={replaceItem} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {nextCursor && !isLoading ? (
        <Button
          type="button"
          variant="outline"
          disabled={isLoadingMore}
          onClick={loadMore}
        >
          {isLoadingMore ? "Cargando…" : "Cargar más conceptos"}
        </Button>
      ) : null}
    </div>
  );
}

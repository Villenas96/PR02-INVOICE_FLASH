"use client";

import Link from "next/link";
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

const SEARCH_DEBOUNCE_MS = 250;

interface ClientListItem {
  id: string;
  name: string;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
  archived_at: string | null;
}

interface ClientPage {
  items: ClientListItem[];
  next_cursor: string | null;
}

function CreateClientDialog({
  onCreated,
}: {
  onCreated: (client: ClientListItem) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const action = useAsyncAction<ClientListItem>();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await action.run(() =>
      apiRequest<ClientListItem>(
        "/api/v1/clients",
        jsonRequest("POST", {
          name: name.trim(),
          tax_id: taxId.trim().toUpperCase() || null,
          address: address.trim() || null,
          email: email.trim() || null,
          phone: phone.trim() || null,
        }),
      ),
    );
    if (created) {
      onCreated(created);
      setIsOpen(false);
      setName("");
      setTaxId("");
      setAddress("");
      setEmail("");
      setPhone("");
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button type="button">Nuevo cliente</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Nuevo cliente</DialogTitle>
            <DialogDescription>
              Guárdalo en tu cartera para facturarlo más rápido.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="new-client-name">Nombre o razón social</Label>
              <Input
                id="new-client-name"
                maxLength={200}
                required
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new-client-tax-id">NIF, NIE o CIF</Label>
                <Input
                  id="new-client-tax-id"
                  aria-describedby="new-client-tax-id-hint"
                  maxLength={9}
                  value={taxId}
                  onChange={(event) =>
                    setTaxId(event.target.value.toUpperCase())
                  }
                />
                <p
                  id="new-client-tax-id-hint"
                  className="text-xs text-muted-foreground"
                >
                  Necesario para emitir facturas.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-client-email">Correo</Label>
                <Input
                  id="new-client-email"
                  type="email"
                  maxLength={320}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-client-address">Dirección fiscal</Label>
              <Input
                id="new-client-address"
                aria-describedby="new-client-address-hint"
                maxLength={500}
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
              <p
                id="new-client-address-hint"
                className="text-xs text-muted-foreground"
              >
                Necesario para emitir facturas.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-client-phone">Teléfono</Label>
              <Input
                id="new-client-phone"
                type="tel"
                maxLength={50}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
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
              {action.isLoading ? "Guardando…" : "Crear cliente"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveToggle({
  client,
  onChanged,
}: {
  client: ClientListItem;
  onChanged: (client: ClientListItem) => void;
}) {
  const action = useAsyncAction<ClientListItem>();
  const isArchived = client.archived_at !== null;

  async function handleClick() {
    const updated = await action.run(() =>
      apiRequest<ClientListItem>(
        `/api/v1/clients/${client.id}/${isArchived ? "unarchive" : "archive"}`,
        { method: "POST" },
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

export function ClientList() {
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [items, setItems] = useState<ClientListItem[]>([]);
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
      return `/api/v1/clients?${params.toString()}`;
    },
    [query, showArchived],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => {
        setIsLoading(true);
        setError(undefined);
        apiRequest<ClientPage>(queryPath(), { signal: controller.signal })
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
                : "No se han podido cargar los clientes.",
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
      const page = await apiRequest<ClientPage>(queryPath(nextCursor));
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.next_cursor);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se han podido cargar más clientes.",
      );
    } finally {
      setIsLoadingMore(false);
    }
  }

  function replaceItem(updated: ClientListItem) {
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
            <Label htmlFor="client-search">Buscar</Label>
            <Input
              id="client-search"
              placeholder="Nombre o NIF"
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
        <CreateClientDialog
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
          <span className="sr-only">Cargando clientes…</span>
        </output>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-10 text-center">
          <h2 className="font-semibold">No hay clientes con estos filtros</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Crea tu primer cliente para empezar a facturar.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>NIF</TableHead>
                <TableHead>Contacto</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((client) => (
                <TableRow key={client.id}>
                  <TableCell>
                    <Link
                      className="font-medium underline-offset-4 hover:underline"
                      href={`/clients/${client.id}`}
                    >
                      {client.name}
                    </Link>
                  </TableCell>
                  <TableCell>{client.tax_id ?? "—"}</TableCell>
                  <TableCell>{client.email ?? client.phone ?? "—"}</TableCell>
                  <TableCell>
                    {client.archived_at ? (
                      <Badge variant="secondary">Archivado</Badge>
                    ) : (
                      <Badge variant="outline">Activo</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <ArchiveToggle client={client} onChanged={replaceItem} />
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
          {isLoadingMore ? "Cargando…" : "Cargar más clientes"}
        </Button>
      ) : null}
    </div>
  );
}

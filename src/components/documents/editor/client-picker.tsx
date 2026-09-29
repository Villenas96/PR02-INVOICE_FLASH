"use client";

import { useEffect, useState } from "react";

import { useAsyncAction } from "@/components/ui/async-action";
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
import { apiRequest, jsonRequest } from "@/lib/api/client";

import type { ClientPage, EditorClient } from "./types";

const SEARCH_DEBOUNCE_MS = 250;

interface ClientPickerProps {
  selectedId: string;
  onChange: (clientId: string) => void;
}

function InlineClientForm({
  onCreate,
  onClose,
}: {
  onCreate: (client: EditorClient) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const action = useAsyncAction<EditorClient>();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await action.run(() =>
      apiRequest<EditorClient>(
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
      onCreate(created);
      onClose();
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>Nuevo cliente</DialogTitle>
        <DialogDescription>
          Se guardará en tu lista y quedará seleccionado en esta factura.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="space-y-2">
          <Label htmlFor="inline-client-name">Nombre o razón social</Label>
          <Input
            id="inline-client-name"
            maxLength={200}
            required
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="inline-client-tax-id">NIF, NIE o CIF</Label>
            <Input
              id="inline-client-tax-id"
              maxLength={9}
              value={taxId}
              onChange={(event) => setTaxId(event.target.value.toUpperCase())}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inline-client-email">Correo</Label>
            <Input
              id="inline-client-email"
              type="email"
              maxLength={320}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="inline-client-address">Dirección fiscal</Label>
          <Input
            id="inline-client-address"
            maxLength={500}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="inline-client-phone">Teléfono</Label>
          <Input
            id="inline-client-phone"
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
          <Button type="button" variant="outline" disabled={action.isLoading}>
            Cancelar
          </Button>
        </DialogClose>
        <Button type="submit" disabled={action.isLoading}>
          {action.isLoading ? "Guardando…" : "Crear cliente"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Self-contained picker: owns its own paginated, debounced search against
 * `GET /api/v1/clients` (archived clients are excluded by that endpoint's
 * default), so the editor only needs the selected id. Live-fetching on every
 * open keeps a later archive/edit from ever surfacing stale client data here.
 */
export function ClientPicker({ selectedId, onChange }: ClientPickerProps) {
  const [query, setQuery] = useState("");
  const [clients, setClients] = useState<EditorClient[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    const trimmed = query.trim();
    const timeout = setTimeout(
      () => {
        const params = new URLSearchParams({ limit: "25" });
        if (trimmed) {
          params.set("q", trimmed);
        }
        apiRequest<ClientPage>(`/api/v1/clients?${params.toString()}`, {
          signal: controller.signal,
        })
          .then((page) => {
            setClients(page.items);
            setNextCursor(page.next_cursor);
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
                : "No se han podido cargar los clientes.",
            );
          });
      },
      trimmed ? SEARCH_DEBOUNCE_MS : 0,
    );

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  async function loadMore() {
    if (!nextCursor || isLoadingMore) {
      return;
    }
    setIsLoadingMore(true);
    try {
      const params = new URLSearchParams({ limit: "25", cursor: nextCursor });
      const trimmed = query.trim();
      if (trimmed) {
        params.set("q", trimmed);
      }
      const page = await apiRequest<ClientPage>(
        `/api/v1/clients?${params.toString()}`,
      );
      setClients((current) => [...current, ...page.items]);
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

  function handleCreated(client: EditorClient) {
    setClients((current) => [client, ...current]);
    onChange(client.id);
  }

  return (
    <div className="space-y-2">
      <div className="space-y-2">
        <Label htmlFor="invoice-client-search">Buscar cliente</Label>
        <Input
          id="invoice-client-search"
          placeholder="Nombre o NIF"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <Label htmlFor="invoice-client">Cliente</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          id="invoice-client"
          className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          value={selectedId}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Sin cliente por ahora</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
              {client.tax_id ? ` · ${client.tax_id}` : ""}
            </option>
          ))}
        </select>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="outline">
              Crear cliente
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <InlineClientForm
              onCreate={handleCreated}
              onClose={() => setIsCreateOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          El cliente es obligatorio para emitir, pero puedes guardar el borrador
          sin elegirlo.
        </p>
        {nextCursor ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isLoadingMore}
            onClick={loadMore}
          >
            {isLoadingMore ? "Cargando…" : "Cargar más"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

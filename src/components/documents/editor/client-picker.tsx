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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, jsonRequest } from "@/lib/api/client";

import type { ClientPage, EditorClient } from "./types";

function InlineClientForm({
  initialName = "",
  onCreate,
  onClose,
}: {
  initialName?: string;
  onCreate: (client: EditorClient) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [taxId, setTaxId] = useState("");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const action = useMutation<EditorClient>();

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
              aria-describedby="inline-client-tax-id-hint"
              maxLength={9}
              value={taxId}
              onChange={(event) => setTaxId(event.target.value.toUpperCase())}
            />
            <p
              id="inline-client-tax-id-hint"
              className="text-xs text-muted-foreground"
            >
              Necesario para emitir facturas.
            </p>
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
            aria-describedby="inline-client-address-hint"
            maxLength={500}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
          <p
            id="inline-client-address-hint"
            className="text-xs text-muted-foreground"
          >
            Necesario para emitir facturas.
          </p>
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

/** The selected client is kept as an object so its name and NIF stay
 * visible whatever the current search shows (FR-004). */
export interface SelectedClient {
  id: string;
  name: string;
  tax_id: string | null;
}

interface ClientPickerProps {
  value: SelectedClient | null;
  onChange: (client: SelectedClient | null) => void;
}

async function loadClients(
  query: string,
  cursor: string | null,
  signal: AbortSignal,
): Promise<ComboboxPage<SelectedClient>> {
  const params = new URLSearchParams({ limit: "25" });
  if (query.trim()) {
    params.set("q", query.trim());
  }
  if (cursor) {
    params.set("cursor", cursor);
  }
  // Archived clients are excluded by the endpoint's default.
  const page = await apiRequest<ClientPage>(
    `/api/v1/clients?${params.toString()}`,
    { signal },
  );
  return {
    items: page.items.map((client) => ({
      id: client.id,
      name: client.name,
      tax_id: client.tax_id,
    })),
    nextCursor: page.next_cursor,
  };
}

/**
 * Searchable client selector with inline creation, so the editor never has
 * to be left to add a client (FR-014, FR-015).
 */
export function ClientPicker({ value, onChange }: ClientPickerProps) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");

  function handleCreated(client: EditorClient) {
    onChange({ id: client.id, name: client.name, tax_id: client.tax_id });
  }

  return (
    <div className="space-y-2">
      <Label id="invoice-client-label">Cliente</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Combobox<SelectedClient>
          id="invoice-client"
          aria-labelledby="invoice-client-label"
          className="min-w-0 flex-1"
          value={value}
          onChange={onChange}
          getKey={(client) => client.id}
          getLabel={(client) => client.name}
          getDescription={(client) =>
            client.tax_id ? `NIF ${client.tax_id}` : "Sin NIF"
          }
          loadOptions={loadClients}
          onCreate={(query) => {
            setCreateName(query);
            setIsCreateOpen(true);
          }}
          clearLabel="Sin cliente"
          placeholder="Selecciona un cliente"
          searchPlaceholder="Buscar por nombre, NIF o ciudad"
          emptyMessage="No hay clientes que coincidan."
        />
        <Dialog
          open={isCreateOpen}
          onOpenChange={(open) => {
            setIsCreateOpen(open);
            if (!open) {
              setCreateName("");
            }
          }}
        >
          <DialogTrigger asChild>
            <Button type="button" variant="outline">
              Crear cliente
            </Button>
          </DialogTrigger>
          <DialogContent>
            <InlineClientForm
              key={createName}
              initialName={createName}
              onCreate={handleCreated}
              onClose={() => setIsCreateOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

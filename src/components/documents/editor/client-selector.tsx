"use client";

import { useState } from "react";

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

import type { EditorClient } from "./types";

interface ClientSelectorProps {
  clients: EditorClient[];
  selectedId: string;
  nextCursor: string | null;
  isLoadingMore: boolean;
  onChange: (clientId: string) => void;
  onCreate: (client: EditorClient) => void;
  onLoadMore: () => Promise<void>;
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

export function ClientSelector({
  clients,
  selectedId,
  nextCursor,
  isLoadingMore,
  onChange,
  onCreate,
  onLoadMore,
}: ClientSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="space-y-2">
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
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="outline">
              Crear cliente
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <InlineClientForm
              onCreate={onCreate}
              onClose={() => setIsOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>
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
            onClick={onLoadMore}
          >
            {isLoadingMore ? "Cargando…" : "Cargar más"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

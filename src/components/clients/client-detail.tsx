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
import { createCents, formatEur } from "@/lib/money";

interface ClientDetailData {
  id: string;
  name: string;
  tax_id: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  archived_at: string | null;
  pending_cents: number;
  overdue_cents: number;
}

interface HistoryDocument {
  id: string;
  doc_type: "invoice" | "proforma" | "receipt";
  status: "draft" | "issued" | "voided";
  full_number: string | null;
  issue_date: string;
  due_date: string | null;
  total_cents: number;
}

interface HistoryPage {
  items: HistoryDocument[];
  next_cursor: string | null;
}

const typeLabels: Record<HistoryDocument["doc_type"], string> = {
  invoice: "Factura",
  proforma: "Proforma",
  receipt: "Recibo",
};
const statusLabels: Record<HistoryDocument["status"], string> = {
  draft: "Borrador",
  issued: "Emitida",
  voided: "Anulada",
};

function formattedDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

function EditClientDialog({
  client,
  onSaved,
}: {
  client: ClientDetailData;
  onSaved: (client: ClientDetailData) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState(client.name);
  const [taxId, setTaxId] = useState(client.tax_id ?? "");
  const [address, setAddress] = useState(client.address ?? "");
  const [email, setEmail] = useState(client.email ?? "");
  const [phone, setPhone] = useState(client.phone ?? "");
  const action = useAsyncAction<ClientDetailData>();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const updated = await action.run(() =>
      apiRequest<ClientDetailData>(
        `/api/v1/clients/${client.id}`,
        jsonRequest("PATCH", {
          name: name.trim(),
          tax_id: taxId.trim().toUpperCase() || null,
          address: address.trim() || null,
          email: email.trim() || null,
          phone: phone.trim() || null,
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
        <Button type="button" variant="outline">
          Editar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Editar cliente</DialogTitle>
            <DialogDescription>
              Los documentos ya emitidos conservan su instantánea original.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-client-name">Nombre o razón social</Label>
              <Input
                id="edit-client-name"
                maxLength={200}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-client-tax-id">NIF, NIE o CIF</Label>
                <Input
                  id="edit-client-tax-id"
                  maxLength={9}
                  value={taxId}
                  onChange={(event) =>
                    setTaxId(event.target.value.toUpperCase())
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-client-email">Correo</Label>
                <Input
                  id="edit-client-email"
                  type="email"
                  maxLength={320}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-client-address">Dirección fiscal</Label>
              <Input
                id="edit-client-address"
                maxLength={500}
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-client-phone">Teléfono</Label>
              <Input
                id="edit-client-phone"
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
              {action.isLoading ? "Guardando…" : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveAction({
  client,
  onChanged,
}: {
  client: ClientDetailData;
  onChanged: (client: ClientDetailData) => void;
}) {
  const action = useAsyncAction<ClientDetailData>();
  const isArchived = client.archived_at !== null;

  async function handleClick() {
    const updated = await action.run(() =>
      apiRequest<ClientDetailData>(
        `/api/v1/clients/${client.id}/${isArchived ? "unarchive" : "archive"}`,
        { method: "POST" },
      ),
    );
    if (updated) {
      onChanged({
        ...updated,
        pending_cents: client.pending_cents,
        overdue_cents: client.overdue_cents,
      });
    }
  }

  return (
    <Button
      type="button"
      variant={isArchived ? "outline" : "destructive"}
      disabled={action.isLoading}
      onClick={handleClick}
    >
      {action.isLoading
        ? "Guardando…"
        : isArchived
          ? "Restaurar cliente"
          : "Archivar cliente"}
    </Button>
  );
}

export function ClientDetail({ clientId }: { clientId: string }) {
  const [client, setClient] = useState<ClientDetailData>();
  const [history, setHistory] = useState<HistoryDocument[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const [detail, historyPage] = await Promise.all([
        apiRequest<ClientDetailData>(`/api/v1/clients/${clientId}`, {
          cache: "no-store",
        }),
        apiRequest<HistoryPage>(`/api/v1/clients/${clientId}/documents`, {
          cache: "no-store",
        }),
      ]);
      setClient(detail);
      setHistory(historyPage.items);
      setNextCursor(historyPage.next_cursor);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se ha podido cargar el cliente.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (!nextCursor || isLoadingMore) {
      return;
    }
    setIsLoadingMore(true);
    try {
      const page = await apiRequest<HistoryPage>(
        `/api/v1/clients/${clientId}/documents?cursor=${encodeURIComponent(nextCursor)}`,
      );
      setHistory((current) => [...current, ...page.items]);
      setNextCursor(page.next_cursor);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se ha podido cargar más historial.",
      );
    } finally {
      setIsLoadingMore(false);
    }
  }

  if (isLoading) {
    return (
      <output className="block h-96 animate-pulse rounded-xl border bg-muted/50">
        <span className="sr-only">Cargando cliente…</span>
      </output>
    );
  }

  if (!client) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6">
        <p
          role="alert"
          className="text-sm text-[color-mix(in_oklch,var(--destructive),var(--foreground)_35%)]"
        >
          {error ?? "No se ha podido cargar el cliente."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-5 rounded-xl border bg-card p-5 shadow-sm sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {client.archived_at ? (
              <Badge variant="secondary">Archivado</Badge>
            ) : (
              <Badge variant="outline">Activo</Badge>
            )}
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            {client.name}
          </h1>
          <address className="mt-2 space-y-1 text-sm not-italic text-muted-foreground">
            <p>{client.tax_id ?? "Sin NIF"}</p>
            <p>{client.address ?? "Sin dirección"}</p>
            <p>{client.email ?? "Sin correo"}</p>
            <p>{client.phone ?? "Sin teléfono"}</p>
          </address>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <EditClientDialog client={client} onSaved={setClient} />
          <ArchiveAction client={client} onChanged={setClient} />
        </div>
      </section>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Pendiente de cobro</p>
          <p
            className="mt-1 text-2xl font-semibold"
            data-testid="client-pending-total"
          >
            {formatEur(createCents(client.pending_cents))}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <p className="text-sm text-destructive">Vencido</p>
          <p className="mt-1 text-2xl font-semibold">
            {formatEur(createCents(client.overdue_cents))}
          </p>
        </div>
      </div>

      <section className="rounded-xl border bg-card shadow-sm">
        <div className="p-5 pb-2">
          <h2 className="font-semibold">Historial de documentos</h2>
        </div>
        {history.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">
            Todavía no hay documentos para este cliente.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Documento</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Emisión</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((document) => (
                <TableRow key={document.id}>
                  <TableCell>
                    <Link
                      className="font-medium underline-offset-4 hover:underline"
                      href={`/documents/${document.id}`}
                    >
                      {document.full_number ?? "Borrador sin número"}
                    </Link>
                  </TableCell>
                  <TableCell>{typeLabels[document.doc_type]}</TableCell>
                  <TableCell>{statusLabels[document.status]}</TableCell>
                  <TableCell>{formattedDate(document.issue_date)}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatEur(createCents(document.total_cents))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {nextCursor ? (
          <div className="p-4">
            <Button
              type="button"
              variant="outline"
              disabled={isLoadingMore}
              onClick={loadMore}
            >
              {isLoadingMore ? "Cargando…" : "Cargar más historial"}
            </Button>
          </div>
        ) : null}
      </section>

      <Button asChild variant="ghost">
        <Link href="/clients">Volver a clientes</Link>
      </Button>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";

import { useMutation } from "@/components/ui/async-action";
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
import { apiRequest, jsonRequest } from "@/lib/api/client";
import { createCents, formatEur, parseEuroInput } from "@/lib/money";

import { type BankTransaction, formattedDate, STATUS_LABELS } from "./types";

interface PendingInvoice {
  id: string;
  full_number: string | null;
  client_display: { name: string } | null;
  outstanding_cents: number;
}

function AllocateDialog({
  transaction,
  onDone,
}: {
  transaction: BankTransaction;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [invoices, setInvoices] = useState<PendingInvoice[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [overpayment, setOverpayment] = useState(false);
  const action = useMutation<unknown>({ refresh: false });
  const remaining = transaction.amount_cents - transaction.allocated_cents;

  useEffect(() => {
    if (!open) {
      return;
    }
    apiRequest<{ items: PendingInvoice[] }>(
      "/api/v1/documents?type=invoice&status=issued&limit=100",
    )
      .then((page) =>
        setInvoices(page.items.filter((item) => item.outstanding_cents > 0)),
      )
      .catch(() => setInvoices([]));
  }, [open]);

  const chosen = Object.entries(amounts).filter(
    ([, value]) => value.trim() !== "",
  );
  let total = 0;
  let invalid = false;
  for (const [, value] of chosen) {
    try {
      total += parseEuroInput(value);
    } catch {
      invalid = true;
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const done = await action.run(() =>
      apiRequest("/api/v1/reconciliations", {
        ...jsonRequest("POST", {
          bank_transaction_id: transaction.id,
          allocations: chosen.map(([documentId, value]) => ({
            document_id: documentId,
            amount_cents: parseEuroInput(value),
          })),
          confirmed_overpayment: overpayment,
        }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
      }),
    );
    if (done !== undefined) {
      setOpen(false);
      setAmounts({});
      onDone();
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          Casar a mano
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Casar movimiento</DialogTitle>
            <DialogDescription>
              {formattedDate(transaction.operation_on)} · {transaction.concept}{" "}
              · pendiente de asignar {formatEur(createCents(remaining))}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 space-y-2 overflow-y-auto py-3">
            {invoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay facturas pendientes de cobro.
              </p>
            ) : (
              invoices.map((invoice) => (
                <div key={invoice.id} className="flex items-center gap-3">
                  <label
                    htmlFor={`allocation-${invoice.id}`}
                    className="flex-1 text-sm"
                  >
                    {invoice.full_number}
                    {invoice.client_display
                      ? ` · ${invoice.client_display.name}`
                      : ""}{" "}
                    <span className="text-muted-foreground">
                      (pendiente{" "}
                      {formatEur(createCents(invoice.outstanding_cents))})
                    </span>
                  </label>
                  <Input
                    id={`allocation-${invoice.id}`}
                    className="w-28"
                    inputMode="decimal"
                    placeholder="0,00"
                    aria-label={`Importe para ${invoice.full_number}`}
                    value={amounts[invoice.id] ?? ""}
                    onChange={(event) =>
                      setAmounts((current) => ({
                        ...current,
                        [invoice.id]: event.target.value,
                      }))
                    }
                  />
                </div>
              ))
            )}
          </div>
          <p className="text-sm">
            Asignado: <strong>{formatEur(createCents(total))}</strong> de{" "}
            {formatEur(createCents(remaining))}
          </p>
          {total > remaining ? (
            <p role="alert" className="text-sm text-destructive">
              No puedes asignar más de lo que ingresó el banco.
            </p>
          ) : null}
          {action.error ? (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-destructive">
                {action.error}
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={overpayment}
                  onChange={(event) => setOverpayment(event.target.checked)}
                />
                Confirmo registrar un sobrepago
              </label>
            </div>
          ) : null}
          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={
                action.isLoading ||
                chosen.length === 0 ||
                invalid ||
                total > remaining ||
                total === 0
              }
            >
              {action.isLoading ? "Registrando…" : "Registrar cobros"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TransactionRow({
  transaction,
  onChanged,
}: {
  transaction: BankTransaction;
  onChanged: () => void;
}) {
  const ignore = useMutation<unknown>({ refresh: false });
  const undo = useMutation<unknown>({ refresh: false });
  const credit = transaction.amount_cents > 0;

  async function setIgnored(ignored: boolean) {
    const done = await ignore.run(() =>
      apiRequest(
        `/api/v1/bank-transactions/${transaction.id}`,
        jsonRequest("PATCH", { ignored }),
      ),
    );
    if (done !== undefined) {
      onChanged();
    }
  }
  async function undoOne(reconciliationId: string) {
    const done = await undo.run(() =>
      apiRequest<void>(`/api/v1/reconciliations/${reconciliationId}`, {
        method: "DELETE",
      }).then(() => null),
    );
    if (done === null) {
      onChanged();
    }
  }

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {formattedDate(transaction.operation_on)} · {transaction.concept}
          </p>
          <p className="text-sm text-muted-foreground">
            <span className={credit ? "" : "text-destructive"}>
              {formatEur(createCents(transaction.amount_cents))}
            </span>{" "}
            ·{" "}
            <Badge variant="outline">{STATUS_LABELS[transaction.status]}</Badge>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {credit &&
          (transaction.status === "pending" ||
            transaction.status === "partial") ? (
            <AllocateDialog transaction={transaction} onDone={onChanged} />
          ) : null}
          {transaction.status === "ignored" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={ignore.isLoading}
              onClick={() => setIgnored(false)}
            >
              Restaurar
            </Button>
          ) : transaction.status === "pending" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={ignore.isLoading}
              onClick={() => setIgnored(true)}
            >
              Ignorar
            </Button>
          ) : null}
        </div>
      </div>
      {transaction.reconciliations.length > 0 ? (
        <ul className="space-y-1 pl-3 text-sm">
          {transaction.reconciliations.map((link) => (
            <li key={link.id} className="flex flex-wrap items-center gap-2">
              <span>
                {link.document_number} ·{" "}
                {formatEur(createCents(link.amount_cents))}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={undo.isLoading}
                onClick={() => undoOne(link.id)}
              >
                Deshacer
                <span className="sr-only">
                  {" "}
                  casamiento con {link.document_number}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {ignore.error || undo.error ? (
        <p role="alert" className="text-xs text-destructive">
          {ignore.error ?? undo.error}
        </p>
      ) : null}
    </li>
  );
}

const FILTERS: Array<[string, string]> = [
  ["", "Todos"],
  ["pending", "Pendientes"],
  ["partial", "Casados en parte"],
  ["reconciled", "Casados"],
  ["ignored", "Ignorados"],
];

export function TransactionsPanel({
  refreshKey,
  onChanged,
}: {
  refreshKey: number;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState("");
  const [items, setItems] = useState<BankTransaction[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const load = useCallback(
    async (cursor?: string) => {
      const params = new URLSearchParams({ limit: "25" });
      if (status) {
        params.set("status", status);
      }
      if (cursor) {
        params.set("cursor", cursor);
      }
      const page = await apiRequest<{
        items: BankTransaction[];
        next_cursor: string | null;
      }>(`/api/v1/bank-transactions?${params}`);
      setItems((current) =>
        cursor && current ? [...current, ...page.items] : page.items,
      );
      setNextCursor(page.next_cursor);
    },
    [status],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the parent signals a change.
  useEffect(() => {
    void load().catch(() => setItems([]));
  }, [load, refreshKey]);

  return (
    <section
      aria-labelledby="movements-title"
      className="rounded-xl border bg-card p-5 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="movements-title" className="text-lg font-semibold">
          Movimientos
        </h2>
        <select
          aria-label="Filtrar movimientos"
          className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          {FILTERS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {!items ? (
        <p className="mt-3 text-sm text-muted-foreground">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No hay movimientos con este filtro.
        </p>
      ) : (
        <ul className="mt-2 divide-y">
          {items.map((transaction) => (
            <TransactionRow
              key={transaction.id}
              transaction={transaction}
              onChanged={() => {
                void load();
                onChanged();
              }}
            />
          ))}
        </ul>
      )}
      {nextCursor ? (
        <Button
          type="button"
          variant="outline"
          className="mt-3"
          onClick={() => load(nextCursor)}
        >
          Ver más
        </Button>
      ) : null}
    </section>
  );
}

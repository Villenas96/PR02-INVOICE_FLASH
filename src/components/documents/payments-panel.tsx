"use client";

import { useState } from "react";

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

export type PaymentMethod = "card" | "cash" | "other" | "transfer";
export type PaymentStatus = "overdue" | "paid" | "partial" | "pending";

export interface DocumentPayment {
  id: string;
  amount_cents: number;
  confirmed_overpayment: boolean;
  paid_on: string;
  method: PaymentMethod | null;
  created_at: string;
  updated_at: string;
}

interface PaymentsPanelProps {
  documentId: string;
  totalCents: number;
  paidCents: number;
  outstandingCents: number;
  paymentStatus: PaymentStatus | null;
  payments: DocumentPayment[];
  onChanged: () => Promise<void>;
}

const STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "Pendiente",
  partial: "Parcialmente pagada",
  paid: "Pagada",
  overdue: "Vencida",
};
const STATUS_VARIANTS: Record<
  PaymentStatus,
  "default" | "destructive" | "outline" | "secondary"
> = {
  pending: "outline",
  partial: "secondary",
  paid: "default",
  overdue: "destructive",
};
const METHOD_LABELS: Record<PaymentMethod, string> = {
  transfer: "Transferencia",
  cash: "Efectivo",
  card: "Tarjeta",
  other: "Otro",
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formattedDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

interface PaymentFormFields {
  amount: string;
  paidOn: string;
  method: "" | PaymentMethod;
}

function PaymentFields({
  fields,
  onChange,
  idPrefix,
}: {
  fields: PaymentFormFields;
  onChange: (fields: PaymentFormFields) => void;
  idPrefix: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-amount`}>Importe cobrado</Label>
        <Input
          id={`${idPrefix}-amount`}
          inputMode="decimal"
          required
          autoFocus
          value={fields.amount}
          onChange={(event) =>
            onChange({ ...fields, amount: event.target.value })
          }
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-paid-on`}>Fecha de cobro</Label>
        <Input
          id={`${idPrefix}-paid-on`}
          type="date"
          required
          value={fields.paidOn}
          onChange={(event) =>
            onChange({ ...fields, paidOn: event.target.value })
          }
        />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-method`}>Método</Label>
        <select
          id={`${idPrefix}-method`}
          className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          value={fields.method}
          onChange={(event) =>
            onChange({
              ...fields,
              method: event.target.value as "" | PaymentMethod,
            })
          }
        >
          <option value="">Sin especificar</option>
          <option value="transfer">Transferencia</option>
          <option value="cash">Efectivo</option>
          <option value="card">Tarjeta</option>
          <option value="other">Otro</option>
        </select>
      </div>
    </div>
  );
}

function CreatePaymentForm({
  documentId,
  outstandingCents,
  onCreated,
  onClose,
}: {
  documentId: string;
  outstandingCents: number;
  onCreated: () => Promise<void>;
  onClose: () => void;
}) {
  const [fields, setFields] = useState<PaymentFormFields>({
    amount: "",
    paidOn: todayIso(),
    method: "",
  });
  const [confirmOverpayment, setConfirmOverpayment] = useState<number>();
  const action = useAsyncAction<DocumentPayment>();

  async function submit(amountCents: number, confirmed: boolean) {
    const created = await action.run(() =>
      apiRequest<DocumentPayment>(
        `/api/v1/documents/${documentId}/payments`,
        jsonRequest("POST", {
          amount_cents: amountCents,
          paid_on: fields.paidOn,
          method: fields.method || null,
          confirmed_overpayment: confirmed,
        }),
      ),
    );
    if (created) {
      await onCreated();
      onClose();
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let amountCents: number;
    try {
      amountCents = parseEuroInput(fields.amount);
    } catch {
      await action.run(() =>
        Promise.reject(
          new Error("Indica un importe positivo con hasta dos decimales."),
        ),
      );
      return;
    }

    if (amountCents > outstandingCents) {
      setConfirmOverpayment(amountCents);
      return;
    }
    await submit(amountCents, false);
  }

  if (confirmOverpayment !== undefined) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>¿Confirmas el sobrepago?</DialogTitle>
          <DialogDescription>
            {formatEur(createCents(confirmOverpayment))} supera el pendiente de{" "}
            {formatEur(createCents(outstandingCents))}. Puedes confirmarlo o
            corregir el importe.
          </DialogDescription>
        </DialogHeader>
        {action.error ? (
          <p role="alert" className="text-sm text-destructive">
            {action.error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={action.isLoading}
            onClick={() => setConfirmOverpayment(undefined)}
          >
            Corregir importe
          </Button>
          <Button
            type="button"
            disabled={action.isLoading}
            onClick={() => submit(confirmOverpayment, true)}
          >
            {action.isLoading ? "Registrando…" : "Confirmar sobrepago"}
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>Registrar cobro</DialogTitle>
        <DialogDescription>
          Pendiente actual: {formatEur(createCents(outstandingCents))}.
        </DialogDescription>
      </DialogHeader>
      <div className="py-2">
        <PaymentFields
          fields={fields}
          onChange={setFields}
          idPrefix="create-payment"
        />
        {action.error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
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
          {action.isLoading ? "Registrando…" : "Registrar cobro"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function EditPaymentForm({
  payment,
  outstandingBeforeThisPayment,
  onSaved,
  onClose,
}: {
  payment: DocumentPayment;
  outstandingBeforeThisPayment: number;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const [fields, setFields] = useState<PaymentFormFields>({
    amount: (payment.amount_cents / 100).toFixed(2).replace(".", ","),
    paidOn: payment.paid_on,
    method: payment.method ?? "",
  });
  const [confirmOverpayment, setConfirmOverpayment] = useState<number>();
  const action = useAsyncAction<DocumentPayment>();

  async function submit(amountCents: number, confirmed: boolean) {
    const updated = await action.run(() =>
      apiRequest<DocumentPayment>(
        `/api/v1/payments/${payment.id}`,
        jsonRequest("PATCH", {
          amount_cents: amountCents,
          paid_on: fields.paidOn,
          method: fields.method || null,
          confirmed_overpayment: confirmed,
        }),
      ),
    );
    if (updated) {
      await onSaved();
      onClose();
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let amountCents: number;
    try {
      amountCents = parseEuroInput(fields.amount);
    } catch {
      await action.run(() =>
        Promise.reject(
          new Error("Indica un importe positivo con hasta dos decimales."),
        ),
      );
      return;
    }

    if (amountCents > outstandingBeforeThisPayment) {
      setConfirmOverpayment(amountCents);
      return;
    }
    await submit(amountCents, false);
  }

  if (confirmOverpayment !== undefined) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>¿Confirmas el sobrepago?</DialogTitle>
          <DialogDescription>
            {formatEur(createCents(confirmOverpayment))} supera el pendiente de{" "}
            {formatEur(createCents(outstandingBeforeThisPayment))} sin este
            cobro. Puedes confirmarlo o corregir el importe.
          </DialogDescription>
        </DialogHeader>
        {action.error ? (
          <p role="alert" className="text-sm text-destructive">
            {action.error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={action.isLoading}
            onClick={() => setConfirmOverpayment(undefined)}
          >
            Corregir importe
          </Button>
          <Button
            type="button"
            disabled={action.isLoading}
            onClick={() => submit(confirmOverpayment, true)}
          >
            {action.isLoading ? "Guardando…" : "Confirmar sobrepago"}
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>Corregir cobro</DialogTitle>
        <DialogDescription>
          El estado de cobro de la factura se recalcula automáticamente.
        </DialogDescription>
      </DialogHeader>
      <div className="py-2">
        <PaymentFields
          fields={fields}
          onChange={setFields}
          idPrefix={`edit-payment-${payment.id}`}
        />
        {action.error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
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
          {action.isLoading ? "Guardando…" : "Guardar cambios"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function DeletePaymentAction({
  payment,
  onDeleted,
}: {
  payment: DocumentPayment;
  onDeleted: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const action = useAsyncAction<null>();

  async function handleDelete() {
    const result = await action.run(() =>
      apiRequest<void>(`/api/v1/payments/${payment.id}`, {
        method: "DELETE",
      }).then(() => null),
    );
    if (result === null) {
      setOpen(false);
      await onDeleted();
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          Eliminar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Eliminar este cobro?</DialogTitle>
          <DialogDescription>
            El estado de cobro de la factura se recalculará. Esta acción no se
            puede deshacer.
          </DialogDescription>
        </DialogHeader>
        {action.error ? (
          <p role="alert" className="text-sm text-destructive">
            {action.error}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancelar
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={action.isLoading}
            onClick={handleDelete}
          >
            {action.isLoading ? "Eliminando…" : "Eliminar cobro"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PaymentsPanel({
  documentId,
  totalCents,
  paidCents,
  outstandingCents,
  paymentStatus,
  payments,
  onChanged,
}: PaymentsPanelProps) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingPaymentId, setEditingPaymentId] = useState<string>();

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Cobros</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {paymentStatus ? (
              <Badge variant={STATUS_VARIANTS[paymentStatus]}>
                {STATUS_LABELS[paymentStatus]}
              </Badge>
            ) : null}
            <span>Cobrado {formatEur(createCents(paidCents))}</span>
            <span>·</span>
            <span>Pendiente {formatEur(createCents(outstandingCents))}</span>
          </div>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button type="button">Registrar cobro</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <CreatePaymentForm
              documentId={documentId}
              outstandingCents={outstandingCents}
              onCreated={onChanged}
              onClose={() => setIsCreateOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {payments.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Todavía no hay cobros registrados.
        </p>
      ) : (
        <Table className="mt-4">
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Método</TableHead>
              <TableHead className="text-right">Importe</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((payment) => (
              <TableRow key={payment.id}>
                <TableCell>{formattedDate(payment.paid_on)}</TableCell>
                <TableCell>
                  {payment.method ? METHOD_LABELS[payment.method] : "—"}
                  {payment.confirmed_overpayment ? (
                    <Badge variant="outline" className="ml-2">
                      Sobrepago
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-right font-medium">
                  {formatEur(createCents(payment.amount_cents))}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Dialog
                      open={editingPaymentId === payment.id}
                      onOpenChange={(open) =>
                        setEditingPaymentId(open ? payment.id : undefined)
                      }
                    >
                      <DialogTrigger asChild>
                        <Button type="button" variant="ghost" size="sm">
                          Editar
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-lg">
                        <EditPaymentForm
                          payment={payment}
                          outstandingBeforeThisPayment={
                            outstandingCents + payment.amount_cents
                          }
                          onSaved={onChanged}
                          onClose={() => setEditingPaymentId(undefined)}
                        />
                      </DialogContent>
                    </Dialog>
                    <DeletePaymentAction
                      payment={payment}
                      onDeleted={onChanged}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        Total de la factura: {formatEur(createCents(totalCents))}.
      </p>
    </section>
  );
}

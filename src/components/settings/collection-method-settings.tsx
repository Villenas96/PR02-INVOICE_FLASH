"use client";

import { useCallback, useEffect, useState } from "react";

import { useMutation } from "@/components/ui/async-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, jsonRequest } from "@/lib/api/client";
import { formatIban } from "@/lib/iban";

type Kind = "bank_account" | "bizum" | "paypal" | "cash" | "other";

interface CollectionMethod {
  id: string;
  kind: Kind;
  label: string;
  holder_name: string | null;
  iban: string | null;
  bic: string | null;
  phone: string | null;
  email_or_url: string | null;
  instructions: string | null;
  is_default: boolean;
  archived_at: string | null;
}

const KIND_LABELS: Record<Kind, string> = {
  bank_account: "Cuenta bancaria",
  bizum: "Bizum",
  paypal: "PayPal",
  cash: "Efectivo",
  other: "Otro",
};

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function detail(method: CollectionMethod): string | null {
  switch (method.kind) {
    case "bank_account":
      return [
        method.holder_name,
        method.iban ? formatIban(method.iban) : null,
        method.bic,
      ]
        .filter(Boolean)
        .join(" · ");
    case "bizum":
      return method.phone;
    case "paypal":
      return method.email_or_url;
    case "other":
      return method.instructions;
    case "cash":
      return null;
  }
}

function NewMethodForm({ onCreated }: { onCreated: () => void }) {
  const [kind, setKind] = useState<Kind>("bank_account");
  const [values, setValues] = useState<Record<string, string>>({});
  const action = useMutation<CollectionMethod>();

  function field(name: string) {
    return {
      value: values[name] ?? "",
      onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
        setValues((current) => ({ ...current, [name]: event.target.value })),
    };
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await action.run(() =>
      apiRequest<CollectionMethod>(
        "/api/v1/collection-methods",
        jsonRequest("POST", {
          kind,
          label: values.label ?? "",
          holder_name: values.holder_name || null,
          iban: values.iban || null,
          bic: values.bic || null,
          phone: values.phone || null,
          email_or_url: values.email_or_url || null,
          instructions: values.instructions || null,
        }),
      ),
    );
    if (created) {
      setValues({});
      onCreated();
    }
  }

  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor="method-kind">Tipo</Label>
        <select
          id="method-kind"
          className={selectClass}
          value={kind}
          onChange={(event) => setKind(event.target.value as Kind)}
        >
          {Object.entries(KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="method-label">Alias</Label>
        <Input id="method-label" required maxLength={60} {...field("label")} />
      </div>
      {kind === "bank_account" ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="method-holder">Titular</Label>
            <Input
              id="method-holder"
              maxLength={120}
              {...field("holder_name")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="method-iban">IBAN</Label>
            <Input
              id="method-iban"
              autoComplete="off"
              maxLength={42}
              {...field("iban")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="method-bic">BIC (opcional)</Label>
            <Input id="method-bic" maxLength={11} {...field("bic")} />
          </div>
        </>
      ) : null}
      {kind === "bizum" ? (
        <div className="space-y-2">
          <Label htmlFor="method-phone">Teléfono</Label>
          <Input
            id="method-phone"
            type="tel"
            maxLength={20}
            {...field("phone")}
          />
        </div>
      ) : null}
      {kind === "paypal" ? (
        <div className="space-y-2">
          <Label htmlFor="method-paypal">Email o enlace de PayPal</Label>
          <Input
            id="method-paypal"
            maxLength={320}
            {...field("email_or_url")}
          />
        </div>
      ) : null}
      {kind === "other" ? (
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="method-instructions">Instrucciones</Label>
          <Input
            id="method-instructions"
            maxLength={300}
            {...field("instructions")}
          />
        </div>
      ) : null}
      {action.error ? (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {action.error}
        </p>
      ) : null}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={action.isLoading}>
          {action.isLoading ? "Guardando…" : "Añadir método de cobro"}
        </Button>
      </div>
    </form>
  );
}

function MethodRow({
  method,
  onChanged,
}: {
  method: CollectionMethod;
  onChanged: () => void;
}) {
  const action = useMutation<CollectionMethod>();

  async function update(body: Record<string, unknown>) {
    const updated = await action.run(() =>
      apiRequest<CollectionMethod>(
        `/api/v1/collection-methods/${method.id}`,
        jsonRequest("PATCH", body),
      ),
    );
    if (updated) {
      onChanged();
    }
  }

  return (
    <li className="flex flex-col gap-2 border-b py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-medium">
          {method.label}{" "}
          <span className="text-sm font-normal text-muted-foreground">
            · {KIND_LABELS[method.kind]}
          </span>
        </p>
        {detail(method) ? (
          <p className="truncate text-sm text-muted-foreground">
            {detail(method)}
          </p>
        ) : null}
        {action.error ? (
          <p role="alert" className="text-xs text-destructive">
            {action.error}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {method.is_default ? (
          <Badge variant="secondary">Por defecto</Badge>
        ) : null}
        {method.archived_at ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={action.isLoading}
            onClick={() => update({ archived: false })}
          >
            Restaurar
          </Button>
        ) : (
          <>
            {!method.is_default ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={action.isLoading}
                onClick={() => update({ is_default: true })}
              >
                Usar por defecto
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={action.isLoading}
              onClick={() => update({ archived: true })}
            >
              Archivar
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

/** «Métodos de cobro» settings (FR-021). */
export function CollectionMethodSettings() {
  const [methods, setMethods] = useState<CollectionMethod[]>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      const page = await apiRequest<{ items: CollectionMethod[] }>(
        "/api/v1/collection-methods",
      );
      setMethods(page.items);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se han podido cargar los métodos de cobro.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section
      aria-labelledby="collection-methods-title"
      className="space-y-4 rounded-xl border bg-card p-5 shadow-sm sm:p-6"
    >
      <div>
        <h2 id="collection-methods-title" className="font-semibold">
          Métodos de cobro
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          El método por defecto se propone en cada factura y aparece en su
          bloque de pago.
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {methods && methods.length > 0 ? (
        <ul>
          {methods.map((method) => (
            <MethodRow key={method.id} method={method} onChanged={load} />
          ))}
        </ul>
      ) : methods ? (
        <p className="text-sm text-muted-foreground">
          Aún no tienes métodos de cobro.
        </p>
      ) : null}
      <NewMethodForm onCreated={load} />
    </section>
  );
}

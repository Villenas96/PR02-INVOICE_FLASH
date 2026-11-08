"use client";

import { useCallback, useEffect, useState } from "react";

import { useMutation } from "@/components/ui/async-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, jsonRequest } from "@/lib/api/client";

interface TaxRate {
  id: string;
  name: string;
  rate: string;
  is_default: boolean;
  archived_at: string | null;
}

function TaxRow({ tax, onChanged }: { tax: TaxRate; onChanged: () => void }) {
  const action = useMutation<TaxRate>();

  async function update(body: Record<string, unknown>) {
    const updated = await action.run(() =>
      apiRequest<TaxRate>(
        `/api/v1/tax-rates/${tax.id}`,
        jsonRequest("PATCH", body),
      ),
    );
    if (updated) {
      onChanged();
    }
  }

  return (
    <li className="flex flex-col gap-2 border-b py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-medium">
          {tax.name} {Number(tax.rate).toLocaleString("es-ES")} %
        </p>
        {action.error ? (
          <p role="alert" className="text-xs text-destructive">
            {action.error}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {tax.is_default ? <Badge variant="secondary">Por defecto</Badge> : null}
        {tax.archived_at ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={action.isLoading}
            onClick={() => update({ archived: false })}
          >
            Restaurar
          </Button>
        ) : !tax.is_default ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={action.isLoading}
              onClick={() => update({ is_default: true })}
            >
              Usar por defecto
            </Button>
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
        ) : null}
      </div>
    </li>
  );
}

/** «Impuestos» settings (FR-023): issued documents keep their tax names. */
export function TaxRateSettings() {
  const [active, setActive] = useState<TaxRate[]>();
  const [archived, setArchived] = useState<TaxRate[]>([]);
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const [error, setError] = useState<string>();
  const create = useMutation<TaxRate>();

  const load = useCallback(async () => {
    try {
      const [activePage, archivedPage] = await Promise.all([
        apiRequest<{ items: TaxRate[] }>("/api/v1/tax-rates"),
        apiRequest<{ items: TaxRate[] }>("/api/v1/tax-rates?archived=true"),
      ]);
      setActive(activePage.items);
      setArchived(archivedPage.items);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se han podido cargar los impuestos.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await create.run(() =>
      apiRequest<TaxRate>(
        "/api/v1/tax-rates",
        jsonRequest("POST", { name: name.trim(), rate: rate.trim() }),
      ),
    );
    if (created) {
      setName("");
      setRate("");
      await load();
    }
  }

  return (
    <section
      aria-labelledby="tax-rates-title"
      className="space-y-4 rounded-xl border bg-card p-5 shadow-sm sm:p-6"
    >
      <div>
        <h2 id="tax-rates-title" className="font-semibold">
          Impuestos
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada documento emitido conserva el nombre y el porcentaje con que se
          emitió, aunque los cambies aquí.
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <ul>
        {[...(active ?? []), ...archived].map((tax) => (
          <TaxRow key={tax.id} tax={tax} onChanged={load} />
        ))}
      </ul>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end"
        onSubmit={handleSubmit}
      >
        <div className="space-y-2">
          <Label htmlFor="tax-name">Nombre</Label>
          <Input
            id="tax-name"
            required
            maxLength={30}
            placeholder="IVA, IGIC, IGI…"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tax-rate">Porcentaje</Label>
          <Input
            id="tax-rate"
            required
            inputMode="decimal"
            placeholder="4,5"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={create.isLoading}>
          {create.isLoading ? "Guardando…" : "Añadir impuesto"}
        </Button>
        {create.error ? (
          <p role="alert" className="text-sm text-destructive sm:col-span-3">
            {create.error}
          </p>
        ) : null}
      </form>
    </section>
  );
}

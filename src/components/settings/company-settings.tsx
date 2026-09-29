"use client";

import { useState } from "react";

import { useAsyncAction } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, jsonRequest } from "@/lib/api/client";
import type { CompanySettings } from "./types";

interface CompanySettingsProps {
  company: CompanySettings;
  onChange: (company: CompanySettings) => void;
}

function Feedback({ error, success }: { error?: string; success: boolean }) {
  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  }
  return success ? (
    <output className="text-sm text-foreground" aria-live="polite">
      Cambios guardados.
    </output>
  ) : null;
}

export function CompanyProfileForm({
  company,
  onChange,
}: CompanySettingsProps) {
  const [legalName, setLegalName] = useState(company.legal_name ?? "");
  const [taxId, setTaxId] = useState(company.tax_id ?? "");
  const [address, setAddress] = useState(company.address ?? "");
  const [email, setEmail] = useState(company.email);
  const [phone, setPhone] = useState(company.phone ?? "");
  const { error, isLoading, run, status } = useAsyncAction<CompanySettings>();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const updated = await run(() =>
      apiRequest<CompanySettings>(
        "/api/v1/company",
        jsonRequest("PUT", {
          legal_name: legalName.trim() || null,
          tax_id: taxId.trim().toUpperCase() || null,
          address: address.trim() || null,
          email: email.trim(),
          phone: phone.trim() || null,
        }),
      ),
    );
    if (updated) {
      onChange(updated);
    }
  }

  return (
    <section
      className="rounded-xl border bg-card p-5 shadow-sm sm:p-6"
      aria-labelledby="company-profile-title"
    >
      <div className="mb-6 space-y-1">
        <h2 id="company-profile-title" className="text-lg font-semibold">
          Datos fiscales
        </h2>
        <p className="text-sm text-muted-foreground">
          Estos datos se copian al emitir y después quedan protegidos en el
          documento.
        </p>
      </div>

      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="legal-name">Nombre o razón social</Label>
            <Input
              id="legal-name"
              autoComplete="organization"
              maxLength={200}
              required
              value={legalName}
              onChange={(event) => setLegalName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tax-id">NIF, NIE o CIF</Label>
            <Input
              id="tax-id"
              autoCapitalize="characters"
              maxLength={9}
              required
              value={taxId}
              onChange={(event) => setTaxId(event.target.value.toUpperCase())}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="company-email">Correo de facturación</Label>
            <Input
              id="company-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="company-address">Dirección fiscal</Label>
            <textarea
              id="company-address"
              autoComplete="street-address"
              className="min-h-24 w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              maxLength={500}
              required
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="company-phone">Teléfono (opcional)</Label>
            <Input
              id="company-phone"
              type="tel"
              autoComplete="tel"
              maxLength={50}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={isLoading}>
            {isLoading ? "Guardando…" : "Guardar datos fiscales"}
          </Button>
          <Feedback error={error} success={status === "success"} />
        </div>
      </form>
    </section>
  );
}

export function InvoicingPreferencesForm({
  company,
  onChange,
}: CompanySettingsProps) {
  const [dueDays, setDueDays] = useState(String(company.default_due_days));
  const [taxRate, setTaxRate] = useState(company.default_tax_rate);
  const [retentionRate, setRetentionRate] = useState(company.retention_rate);
  const [currency, setCurrency] = useState(company.currency);
  const { error, isLoading, run, status } = useAsyncAction<CompanySettings>();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const updated = await run(() =>
      apiRequest<CompanySettings>(
        "/api/v1/company",
        jsonRequest("PUT", {
          default_due_days: Number(dueDays),
          default_tax_rate: taxRate,
          retention_rate: retentionRate,
          currency: currency.trim().toUpperCase(),
        }),
      ),
    );
    if (updated) {
      onChange(updated);
    }
  }

  return (
    <section
      className="rounded-xl border bg-card p-5 shadow-sm sm:p-6"
      aria-labelledby="preferences-title"
    >
      <div className="mb-6 space-y-1">
        <h2 id="preferences-title" className="text-lg font-semibold">
          Preferencias de facturación
        </h2>
        <p className="text-sm text-muted-foreground">
          Se aplicarán como valores iniciales; podrás ajustarlos en cada
          factura.
        </p>
      </div>

      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="default-due-days">Vencimiento predeterminado</Label>
            <div className="flex items-center gap-2">
              <Input
                id="default-due-days"
                type="number"
                inputMode="numeric"
                min={1}
                max={3650}
                required
                value={dueDays}
                onChange={(event) => setDueDays(event.target.value)}
              />
              <span className="text-sm text-muted-foreground">días</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="default-tax-rate">IVA predeterminado</Label>
            <select
              id="default-tax-rate"
              className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={taxRate}
              onChange={(event) => setTaxRate(event.target.value)}
            >
              <option value="0.00">0 %</option>
              <option value="4.00">4 %</option>
              <option value="10.00">10 %</option>
              <option value="21.00">21 %</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="retention-rate">Retención IRPF</Label>
            <div className="flex items-center gap-2">
              <Input
                id="retention-rate"
                type="number"
                inputMode="decimal"
                min={0}
                max={99.99}
                step="0.01"
                required
                value={retentionRate}
                onChange={(event) => setRetentionRate(event.target.value)}
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="currency">Moneda</Label>
            <Input
              id="currency"
              autoCapitalize="characters"
              maxLength={3}
              minLength={3}
              pattern="[A-Za-z]{3}"
              required
              value={currency}
              onChange={(event) =>
                setCurrency(event.target.value.toUpperCase())
              }
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={isLoading}>
            {isLoading ? "Guardando…" : "Guardar preferencias"}
          </Button>
          <Feedback error={error} success={status === "success"} />
        </div>
      </form>
    </section>
  );
}

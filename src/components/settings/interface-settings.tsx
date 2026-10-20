"use client";

import { useState } from "react";

import { useMutation } from "@/components/ui/async-action";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { apiRequest, jsonRequest } from "@/lib/api/client";

import type { CompanySettings } from "./types";

/**
 * Pro can switch to the simple interface and keep its Pro features under
 * «Más» (FR-060). The layout re-renders through `router.refresh()`.
 */
export function InterfaceSettings({
  company,
  onChange,
}: {
  company: CompanySettings;
  onChange: (company: CompanySettings) => void;
}) {
  const action = useMutation<CompanySettings>();
  // Optimistic: the checkbox answers immediately and reverts on failure.
  const [pending, setPending] = useState<boolean | null>(null);
  const simple = pending ?? company.effective_ui === "simple";

  async function toggle(nextSimple: boolean) {
    setPending(nextSimple);
    const updated = await action.run(() =>
      apiRequest<CompanySettings>(
        "/api/v1/company",
        jsonRequest("PUT", { ui_mode: nextSimple ? "simple" : "full" }),
      ),
    );
    if (updated) {
      onChange(updated);
    }
    setPending(null);
  }

  return (
    <section
      aria-labelledby="interface-title"
      className="space-y-3 rounded-xl border bg-card p-5 shadow-sm sm:p-6"
    >
      <h2 id="interface-title" className="font-semibold">
        Interfaz
      </h2>
      <div className="flex items-start gap-3">
        <Checkbox
          id="simple-interface"
          checked={simple}
          disabled={action.isLoading}
          onCheckedChange={(checked) => toggle(checked === true)}
        />
        <div className="space-y-1">
          <Label htmlFor="simple-interface">Interfaz sencilla</Label>
          <p className="text-sm text-muted-foreground">
            Muestra solo facturas, clientes, productos y ajustes. Tus funciones
            Pro siguen disponibles desde el menú «Más».
          </p>
        </div>
      </div>
      {action.error ? (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      ) : null}
    </section>
  );
}

"use client";

import { Label } from "@/components/ui/label";

export type EditableDocumentType = "invoice" | "proforma";

const OPTIONS: Array<{ value: EditableDocumentType; label: string }> = [
  { value: "invoice", label: "Factura" },
  { value: "proforma", label: "Proforma" },
];

/**
 * Only invoices and proformas are ever chosen here: receipts are generated
 * directly from a payment (FR-011) and never appear as an editor option.
 */
export function DocumentTypeSelector({
  value,
  onChange,
}: {
  value: EditableDocumentType;
  onChange: (value: EditableDocumentType) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="document-type">Tipo de documento</Label>
      <select
        id="document-type"
        className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        value={value}
        onChange={(event) =>
          onChange(event.target.value as EditableDocumentType)
        }
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

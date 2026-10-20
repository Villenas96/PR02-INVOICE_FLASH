"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiRequest } from "@/lib/api/client";
import { createCents, formatEur } from "@/lib/money";

import {
  ACTION_LABELS,
  FREQUENCY_LABELS,
  type RecurringTemplate,
  STATUS_LABELS,
} from "./types";

function formattedDate(date: string | null): string {
  if (!date) {
    return "—";
  }
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

export function RecurringList() {
  const [items, setItems] = useState<RecurringTemplate[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    apiRequest<{ items: RecurringTemplate[] }>(
      "/api/v1/recurring-templates?limit=100",
    )
      .then((page) => setItems(page.items))
      .catch(() => setError(true));
  }, []);

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        No se han podido cargar las recurrencias.
      </p>
    );
  }
  if (!items) {
    return (
      <output className="block h-32 animate-pulse rounded-xl border bg-muted/50">
        <span className="sr-only">Cargando recurrencias…</span>
      </output>
    );
  }
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-card p-10 text-center">
        <h2 className="font-semibold">
          Todavía no tienes facturas recurrentes
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Crea una para que se genere sola cada mes, trimestre o año.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Recurrencia</TableHead>
            <TableHead>Importe</TableHead>
            <TableHead>Acción</TableHead>
            <TableHead>Próximo ciclo</TableHead>
            <TableHead>Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((template) => (
            <TableRow key={template.id}>
              <TableCell>
                <Link
                  className="font-medium underline-offset-4 hover:underline"
                  href={`/recurring/${template.id}`}
                >
                  {template.lines[0]?.description ?? "Recurrencia"}
                </Link>
                <span className="block text-xs text-muted-foreground">
                  {FREQUENCY_LABELS[template.frequency]} · desde{" "}
                  {formattedDate(template.start_on)}
                </span>
              </TableCell>
              <TableCell>
                {formatEur(
                  createCents(
                    template.lines.reduce(
                      (sum, line) =>
                        sum +
                        Math.round(
                          Number(line.quantity) * line.unit_price_cents,
                        ),
                      0,
                    ),
                  ),
                )}
                <span className="block text-xs text-muted-foreground">
                  sin impuestos
                </span>
              </TableCell>
              <TableCell>{ACTION_LABELS[template.action]}</TableCell>
              <TableCell>{formattedDate(template.next_run_on)}</TableCell>
              <TableCell>
                <Badge
                  variant={template.status === "active" ? "default" : "outline"}
                >
                  {STATUS_LABELS[template.status]}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

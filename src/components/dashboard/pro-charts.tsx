"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { createCents, formatEur } from "@/lib/money";

export interface MonthlyPoint {
  month: string;
  invoiced_cents: number;
  collected_cents: number;
}

const CONFIG = {
  invoiced: { label: "Facturado", color: "var(--chart-1)" },
  collected: { label: "Cobrado", color: "var(--chart-2)" },
} satisfies ChartConfig;

const MONTH_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  month: "short",
  year: "2-digit",
  timeZone: "UTC",
});

function monthLabel(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return MONTH_FORMATTER.format(
    new Date(Date.UTC(year ?? 0, (number ?? 1) - 1, 1)),
  );
}

function euros(cents: number): string {
  return formatEur(createCents(cents));
}

/** Invoiced vs collected per month, with the same data as an accessible table. */
export function InvoicedVsCollectedChart({ data }: { data: MonthlyPoint[] }) {
  const points = data.map((point) => ({
    month: monthLabel(point.month),
    invoiced: point.invoiced_cents / 100,
    collected: point.collected_cents / 100,
  }));
  return (
    <figure className="space-y-3">
      <ChartContainer config={CONFIG} className="h-64 w-full">
        <BarChart accessibilityLayer data={points}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} />
          <YAxis
            width={56}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => `${Math.round(value / 1000)} k€`}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="invoiced" fill="var(--color-invoiced)" radius={3} />
          <Bar dataKey="collected" fill="var(--color-collected)" radius={3} />
        </BarChart>
      </ChartContainer>
      <figcaption className="sr-only">
        Facturado y cobrado en los últimos 12 meses.
      </figcaption>
      <table className="sr-only">
        <caption>Facturado y cobrado por mes</caption>
        <thead>
          <tr>
            <th scope="col">Mes</th>
            <th scope="col">Facturado</th>
            <th scope="col">Cobrado</th>
          </tr>
        </thead>
        <tbody>
          {data.map((point) => (
            <tr key={point.month}>
              <th scope="row">{monthLabel(point.month)}</th>
              <td>{euros(point.invoiced_cents)}</td>
              <td>{euros(point.collected_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

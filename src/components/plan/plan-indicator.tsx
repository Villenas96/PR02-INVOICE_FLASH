import Link from "next/link";

import type { TypeUsageData } from "@/components/plan/types";
import { documentTypePlural } from "@/lib/documents/labels";
import { cn } from "@/lib/utils";

export interface PlanIndicatorProps {
  planLabel: string;
  usage: TypeUsageData[];
  /** Hide the «Mejorar» link (e.g. for read-only advisors). */
  canUpgrade?: boolean;
  className?: string;
}

function UsageBar({ usage }: { usage: TypeUsageData }) {
  const label = documentTypePlural(usage.document_type);
  const percentage =
    usage.limit > 0 ? Math.min((usage.used / usage.limit) * 100, 100) : 0;
  const barColor = usage.reached
    ? "bg-destructive"
    : usage.warning
      ? "bg-amber-500"
      : "bg-primary";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="capitalize text-muted-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {usage.used} de {usage.limit}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={`${label} emitidas este mes`}
        aria-valuemin={0}
        aria-valuemax={usage.limit}
        aria-valuenow={usage.used}
      >
        <div
          className={cn("h-full transition-[width]", barColor)}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Monthly per-type quota (FR-008, FR-009). Invoices are always visible; the
 * other types fold away unless one of them needs attention. The 80 % warning
 * never blocks: it only invites to upgrade.
 */
export function PlanIndicator({
  planLabel,
  usage,
  canUpgrade = true,
  className,
}: PlanIndicatorProps) {
  const invoices = usage.find((entry) => entry.document_type === "invoice");
  const others = usage.filter((entry) => entry.document_type !== "invoice");
  const attention = usage.filter((entry) => entry.warning);
  const reached = attention.filter((entry) => entry.reached);
  const othersNeedAttention = others.some((entry) => entry.warning);

  return (
    <div className={cn("min-w-44 space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium">Plan {planLabel}</span>
        {canUpgrade && attention.length > 0 ? (
          <Link
            href="/billing"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Mejorar
          </Link>
        ) : null}
      </div>
      {invoices ? <UsageBar usage={invoices} /> : null}
      {others.length > 0 ? (
        <details className="group text-xs" open={othersNeedAttention}>
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Otros documentos
          </summary>
          <div className="mt-1.5 space-y-1.5">
            {others.map((entry) => (
              <UsageBar key={entry.document_type} usage={entry} />
            ))}
          </div>
        </details>
      ) : null}
      {attention.length > 0 ? (
        <p
          aria-live="polite"
          className={cn(
            "text-xs",
            reached.length > 0 ? "text-destructive" : "text-amber-700",
          )}
        >
          {reached.length > 0
            ? `Límite mensual alcanzado: ${reached
                .map((entry) => documentTypePlural(entry.document_type))
                .join(", ")}.`
            : `Te quedan ${attention
                .map(
                  (entry) =>
                    `${entry.limit - entry.used} ${documentTypePlural(entry.document_type)}`,
                )
                .join(", ")} este mes.`}
        </p>
      ) : null}
    </div>
  );
}

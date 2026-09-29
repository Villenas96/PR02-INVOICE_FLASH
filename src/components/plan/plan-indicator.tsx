import { cn } from "@/lib/utils";

export interface PlanIndicatorProps {
  plan?: "free" | "pro";
  issuedDocuments?: number;
  documentLimit?: number;
  className?: string;
}

export function PlanIndicator({
  plan = "free",
  issuedDocuments = 0,
  documentLimit = plan === "free" ? 5 : 100,
  className,
}: PlanIndicatorProps) {
  const percentage = Math.min((issuedDocuments / documentLimit) * 100, 100);
  const planLabel = plan === "free" ? "Plan gratuito" : "Plan Pro";
  const limitReached = issuedDocuments >= documentLimit;
  const warning = !limitReached && issuedDocuments / documentLimit >= 0.8;
  const barColor = limitReached
    ? "bg-destructive"
    : warning
      ? "bg-amber-500"
      : "bg-primary";

  return (
    <div className={cn("min-w-44 space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium">{planLabel}</span>
        <span className="text-muted-foreground">
          {issuedDocuments}/{documentLimit}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={planLabel}
        aria-valuemin={0}
        aria-valuemax={documentLimit}
        aria-valuenow={issuedDocuments}
      >
        <div
          className={cn("h-full transition-[width]", barColor)}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {limitReached || warning ? (
        <p
          className={cn(
            "text-xs",
            limitReached ? "text-destructive" : "text-amber-700",
          )}
        >
          {limitReached
            ? "Límite mensual alcanzado"
            : `Te quedan ${documentLimit - issuedDocuments} emisiones este mes`}
        </p>
      ) : null}
    </div>
  );
}

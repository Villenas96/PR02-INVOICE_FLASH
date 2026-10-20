import { SparklesIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { Upsell } from "@/lib/api/client";
import { documentTypePlural } from "@/lib/documents/labels";
import {
  type Feature,
  type Plan,
  planLabel,
  requiredPlanFor,
} from "@/lib/plan";
import { cn } from "@/lib/utils";

const FEATURE_COPY: Record<Feature, { title: string; description: string }> = {
  email: {
    title: "Envío de documentos por email",
    description:
      "Envía cada factura a tu cliente desde la app, con enlace al documento y PDF adjunto.",
  },
  period_export: {
    title: "Excel del periodo para tu gestoría",
    description:
      "Descarga el mes, el trimestre o el año en una hoja de cálculo con el desglose fiscal y envíala a tu asesoría.",
  },
  advanced_export: {
    title: "Exportación avanzada",
    description:
      "Filtra por tipo, fechas, estado y cliente, y descarga Excel y los PDF comprimidos.",
  },
  document_xlsx: {
    title: "Documento en hoja de cálculo",
    description:
      "Descarga cualquier documento emitido en Excel, con los mismos importes que el PDF.",
  },
  advisor_schedule: {
    title: "Envío automático a la asesoría",
    description:
      "Tu gestoría recibe cada mes o cada trimestre el paquete del periodo sin que hagas nada.",
  },
  advisor_access: {
    title: "Acceso para tu gestoría",
    description:
      "Invita a tu gestoría para que consulte y exporte tus documentos sin poder modificarlos.",
  },
  catalog_import: {
    title: "Importación de productos",
    description:
      "Carga tu catálogo desde un CSV con previsualización y validación antes de crear nada.",
  },
  recurring: {
    title: "Facturas recurrentes",
    description:
      "Programa cuotas mensuales o trimestrales y Factum genera, emite y envía cada factura a su fecha.",
  },
  reminders: {
    title: "Recordatorios de pago",
    description:
      "Avisa automáticamente a tus clientes antes y después del vencimiento hasta que paguen.",
  },
  bank_reconciliation: {
    title: "Conciliación bancaria",
    description:
      "Importa el extracto de tu banco y marca las facturas cobradas en un par de clics.",
  },
  dashboard_full: {
    title: "Panel completo",
    description:
      "Facturación y cobros de 12 meses, principales clientes, impuestos repercutidos y tesorería.",
  },
  ai_assistant: {
    title: "Conexión con asistentes de IA",
    description:
      "Consulta y prepara documentos desde tu asistente de IA, con confirmación antes de emitir.",
  },
  full_ui: {
    title: "Interfaz completa",
    description:
      "Todas las secciones a la vista, con acceso directo a las funciones Pro.",
  },
};

export function featureTitle(feature: Feature): string {
  return FEATURE_COPY[feature].title;
}

interface UpsellCardProps {
  title: string;
  description: string;
  requiredPlan: Plan;
  upgradeUrl?: string;
  variant?: "page" | "inline";
  className?: string;
}

function UpsellCard({
  title,
  description,
  requiredPlan,
  upgradeUrl = "/billing",
  variant = "inline",
  className,
}: UpsellCardProps) {
  const Heading = variant === "page" ? "h1" : "h2";
  return (
    <section
      aria-labelledby="upsell-title"
      className={cn(
        "rounded-xl border bg-card shadow-sm",
        variant === "page"
          ? "mx-auto max-w-xl p-6 text-center sm:p-8"
          : "flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className={cn(variant === "page" ? "space-y-3" : "space-y-1")}>
        {variant === "page" ? (
          <SparklesIcon
            aria-hidden="true"
            className="mx-auto size-8 text-primary"
          />
        ) : null}
        <Heading
          id="upsell-title"
          className={cn(
            "font-semibold",
            variant === "page" ? "text-xl" : "text-sm",
          )}
        >
          {title}
        </Heading>
        <p className="text-sm text-muted-foreground">{description}</p>
        <p className="text-sm">
          Disponible en el plan <strong>{planLabel(requiredPlan)}</strong>.
        </p>
      </div>
      <Button asChild className={cn(variant === "page" ? "mt-5" : "shrink-0")}>
        <Link href={upgradeUrl}>Mejorar a {planLabel(requiredPlan)}</Link>
      </Button>
    </section>
  );
}

/**
 * Brief explanation of a feature outside the current plan with an upgrade
 * invitation (FR-058). Used for direct access to a Pro page and whenever the
 * API answers `feature_not_in_plan`; never shown as an error.
 */
export function FeatureUpsell({
  feature,
  variant = "page",
  className,
}: {
  feature: Feature;
  variant?: "page" | "inline";
  className?: string;
}) {
  const copy = FEATURE_COPY[feature];
  return (
    <UpsellCard
      title={copy.title}
      description={copy.description}
      requiredPlan={requiredPlanFor(feature)}
      variant={variant}
      className={className}
    />
  );
}

/** Inline invitation built from an API upsell (feature or quota limit). */
export function UpsellNotice({
  upsell,
  upgradeUrl,
  className,
}: {
  upsell: Upsell;
  /** Overrides the API link, e.g. to resume an issue after paying. */
  upgradeUrl?: string;
  className?: string;
}) {
  if (upsell.kind === "feature") {
    return (
      <UpsellCard
        title={FEATURE_COPY[upsell.feature].title}
        description={upsell.message}
        requiredPlan={upsell.requiredPlan}
        upgradeUrl={upgradeUrl ?? upsell.upgradeUrl}
        className={className}
      />
    );
  }
  return (
    <UpsellCard
      title={`Has emitido ${upsell.used} de ${upsell.limit} ${documentTypePlural(upsell.documentType)} este mes`}
      description="Tu borrador se conserva sin número. Mejora tu plan para emitirlo ahora o espera al mes que viene."
      requiredPlan={upsell.plan === "basic" ? "essential" : "pro"}
      upgradeUrl={upgradeUrl ?? upsell.upgradeUrl}
      className={className}
    />
  );
}

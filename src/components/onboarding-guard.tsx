import Link from "next/link";

import { Button } from "@/components/ui/button";

type FiscalField = "address" | "legal_name" | "tax_id";

const fieldLabels: Record<FiscalField, string> = {
  legal_name: "nombre o razón social",
  tax_id: "NIF, NIE o CIF",
  address: "dirección fiscal",
};

interface OnboardingGuardProps {
  children: React.ReactNode;
  missingFields: FiscalField[];
}

export function OnboardingGuard({
  children,
  missingFields,
}: OnboardingGuardProps) {
  if (missingFields.length === 0) {
    return children;
  }

  const missingLabels = missingFields.map((field) => fieldLabels[field]);

  return (
    <>
      <aside
        className="mb-6 flex flex-col gap-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
        aria-labelledby="onboarding-title"
      >
        <div className="space-y-1">
          <h2 id="onboarding-title" className="font-semibold">
            Completa tus datos fiscales para emitir
          </h2>
          <p className="text-sm leading-6">
            Te {missingFields.length === 1 ? "falta" : "faltan"}{" "}
            {new Intl.ListFormat("es", {
              style: "long",
              type: "conjunction",
            }).format(missingLabels)}
            . Puedes preparar borradores mientras tanto.
          </p>
        </div>
        <Button asChild className="shrink-0">
          <Link href="/settings#company-profile-title">
            Completar configuración
          </Link>
        </Button>
      </aside>
      {children}
    </>
  );
}

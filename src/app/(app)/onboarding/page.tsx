import { OwnerOnly } from "@/components/access/owner-only";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export default function OnboardingPage() {
  return (
    <OwnerOnly>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Configura tu negocio
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cinco pasos cortos para emitir tu primera factura. Puedes omitir los
            que quieras y volver cuando te venga bien.
          </p>
        </div>
        <OnboardingWizard />
      </div>
    </OwnerOnly>
  );
}

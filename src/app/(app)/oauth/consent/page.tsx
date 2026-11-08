import { OwnerOnly } from "@/components/access/owner-only";
import { ConsentForm } from "@/components/oauth/consent-form";

export default function ConsentPage() {
  return (
    <OwnerOnly>
      <div className="space-y-6">
        <h1 className="text-3xl font-semibold tracking-tight">
          Conectar un asistente de IA
        </h1>
        <ConsentForm />
      </div>
    </OwnerOnly>
  );
}

import { OwnerOnly } from "@/components/access/owner-only";
import { PlanComparison } from "@/components/plan/plan-comparison";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const resume = typeof params.resume === "string" ? params.resume : undefined;
  const notice =
    params.activated === "1"
      ? "activated"
      : params.canceled === "1"
        ? "canceled"
        : params.updated === "1"
          ? "updated"
          : undefined;

  return (
    <OwnerOnly>
      <div className="space-y-8">
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Planes</p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Elige el plan que encaja con tu negocio
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Los límites se cuentan por tipo de documento y mes. Cambiar de plan
            nunca borra tus datos.
          </p>
        </div>
        <PlanComparison
          resumeDocumentId={
            resume && UUID_PATTERN.test(resume) ? resume : undefined
          }
          notice={notice}
        />
      </div>
    </OwnerOnly>
  );
}

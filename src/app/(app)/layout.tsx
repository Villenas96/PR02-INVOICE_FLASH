import { and, count, eq, gte, inArray, lt } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { OnboardingGuard } from "@/components/onboarding-guard";
import { PlanIndicator } from "@/components/plan/plan-indicator";
import { createDatabase } from "@/db";
import { companies } from "@/db/schema/company";
import { documents } from "@/db/schema/document";
import { auth } from "@/lib/auth";
import { getMadridMonthBounds, getPlanCapabilities } from "@/lib/plan";

const navigation = [
  { href: "/dashboard", label: "Resumen" },
  { href: "/documents", label: "Facturas" },
  { href: "/clients", label: "Clientes" },
  { href: "/catalog", label: "Catálogo" },
  { href: "/settings", label: "Configuración" },
];

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login");
  }

  const database = createDatabase();
  const [company] = await database
    .select({
      legalName: companies.legalName,
      taxId: companies.taxId,
      address: companies.address,
      plan: companies.plan,
      id: companies.id,
    })
    .from(companies)
    .where(eq(companies.userId, session.user.id))
    .limit(1);
  const missingFields: Array<"address" | "legal_name" | "tax_id"> = [];
  if (!company?.legalName?.trim()) {
    missingFields.push("legal_name");
  }
  if (!company?.taxId?.trim()) {
    missingFields.push("tax_id");
  }
  if (!company?.address?.trim()) {
    missingFields.push("address");
  }
  const plan = company?.plan ?? "free";
  const { docLimit } = getPlanCapabilities(plan);
  let issuedDocuments = 0;
  if (company) {
    const { start, endExclusive } = getMadridMonthBounds(new Date());
    const [usage] = await database
      .select({ value: count(documents.id) })
      .from(documents)
      .where(
        and(
          eq(documents.companyId, company.id),
          inArray(documents.status, ["issued", "voided"]),
          gte(documents.issuedAt, start),
          lt(documents.issuedAt, endExclusive),
        ),
      );
    issuedDocuments = Number(usage?.value ?? 0);
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/dashboard" className="font-semibold tracking-tight">
            Invoice Flash
          </Link>
          <PlanIndicator
            plan={plan}
            issuedDocuments={issuedDocuments}
            documentLimit={docLimit}
          />
        </div>
        <nav
          className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-3 sm:px-6"
          aria-label="Principal"
        >
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <OnboardingGuard missingFields={missingFields}>
          {children}
        </OnboardingGuard>
      </main>
    </div>
  );
}

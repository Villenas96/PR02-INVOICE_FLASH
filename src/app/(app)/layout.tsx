import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { OnboardingGuard } from "@/components/onboarding-guard";
import { PlanIndicator } from "@/components/plan/plan-indicator";
import { auth } from "@/lib/auth";
import { planLabel } from "@/lib/plan";
import { usageResponse } from "@/services/company-summary";
import { getLayoutData } from "@/services/layout-data";

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

  const summary = await getLayoutData(session.user.id);
  // A brand-new account has no company row until its first API call; it is
  // treated as an incomplete Basic company.
  const missingFields = summary?.missingFields ?? [
    "legal_name",
    "tax_id",
    "address",
  ];
  const plan = summary?.plan ?? "basic";
  const usage = summary?.usage.map(usageResponse) ?? [];

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/dashboard" className="font-semibold tracking-tight">
            Invoice Flash
          </Link>
          <PlanIndicator planLabel={planLabel(plan)} usage={usage} />
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

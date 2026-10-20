import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Suspense } from "react";

import { ReadOnlyProvider } from "@/components/access/read-only";
import { AppNav } from "@/components/navigation/app-nav";
import { CompanySwitcher } from "@/components/navigation/company-switcher";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { OnboardingGuard } from "@/components/onboarding-guard";
import { PlanIndicator } from "@/components/plan/plan-indicator";
import { Badge } from "@/components/ui/badge";
import { auth } from "@/lib/auth";
import { CREATABLE_DOCUMENT_TYPES } from "@/lib/documents/creatable";
import { buildNavigation } from "@/lib/navigation";
import { planLabel } from "@/lib/plan";
import { usageResponse } from "@/services/company-summary";
import { getLayoutData } from "@/services/layout-data";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login");
  }

  const summary = await getLayoutData(session.user.id, session.session.id);
  // A brand-new account has no company row until its first API call; it is
  // treated as an incomplete Basic company.
  const missingFields = summary?.missingFields ?? [
    "legal_name",
    "tax_id",
    "address",
  ];
  const plan = summary?.plan ?? "basic";
  const readOnly = summary?.role === "advisor";
  const usage = summary?.usage.map(usageResponse) ?? [];
  const navigation = buildNavigation({
    plan,
    uiMode: summary?.uiMode ?? null,
    usedDocumentTypes: summary?.usedDocumentTypes ?? [],
    creatableTypes: CREATABLE_DOCUMENT_TYPES,
  });

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background print:hidden">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/dashboard" className="font-semibold tracking-tight">
            Invoice Flash
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <CompanySwitcher activeCompanyId={summary?.company.id ?? null} />
            {readOnly ? (
              <Badge variant="secondary">Gestoría · solo lectura</Badge>
            ) : (
              <PlanIndicator planLabel={planLabel(plan)} usage={usage} />
            )}
            <NotificationBell />
          </div>
        </div>
        <Suspense>
          <AppNav navigation={navigation} readOnly={readOnly} />
        </Suspense>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <ReadOnlyProvider readOnly={readOnly}>
          {summary?.suspended ? (
            <section className="mx-auto max-w-xl rounded-xl border bg-card p-6 text-center shadow-sm">
              <h1 className="text-xl font-semibold">Acceso en pausa</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Esta empresa ya no tiene el plan Pro, así que el acceso de la
                gestoría está en pausa. Se reactivará solo cuando vuelva a Pro.
                Puedes cambiar a otra empresa desde el selector.
              </p>
            </section>
          ) : (
            <OnboardingGuard missingFields={readOnly ? [] : missingFields}>
              {children}
            </OnboardingGuard>
          )}
        </ReadOnlyProvider>
      </main>
    </div>
  );
}

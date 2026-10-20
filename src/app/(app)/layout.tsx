import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Suspense } from "react";

import { AppNav } from "@/components/navigation/app-nav";
import { OnboardingGuard } from "@/components/onboarding-guard";
import { PlanIndicator } from "@/components/plan/plan-indicator";
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
  const navigation = buildNavigation({
    plan,
    uiMode: summary?.uiMode ?? null,
    usedDocumentTypes: summary?.usedDocumentTypes ?? [],
    creatableTypes: CREATABLE_DOCUMENT_TYPES,
  });

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/dashboard" className="font-semibold tracking-tight">
            Invoice Flash
          </Link>
          <PlanIndicator planLabel={planLabel(plan)} usage={usage} />
        </div>
        <Suspense>
          <AppNav navigation={navigation} />
        </Suspense>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <OnboardingGuard missingFields={missingFields}>
          {children}
        </OnboardingGuard>
      </main>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { apiRequest, jsonRequest } from "@/lib/api/client";
import type { OnboardingProgress } from "@/lib/onboarding";

/** Resumable setup banner (FR-048): what is left and where to continue. */
export function OnboardingBanner({
  progress,
}: {
  progress: OnboardingProgress;
}) {
  const pathname = usePathname();
  const [hidden, setHidden] = useState(false);
  if (hidden || !progress.showBanner || pathname?.startsWith("/onboarding")) {
    return null;
  }
  const pending = progress.steps.filter((entry) => entry.status !== "done");
  const untouched = progress.resolved === 0;

  async function dismiss() {
    setHidden(true);
    try {
      await apiRequest(
        "/api/v1/company/onboarding",
        jsonRequest("PATCH", { dismiss: true }),
      );
    } catch {
      setHidden(false);
    }
  }

  return (
    <aside
      className="mb-6 flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm print:hidden sm:flex-row sm:items-center sm:justify-between"
      aria-labelledby="onboarding-progress-title"
    >
      <div className="space-y-1">
        <h2 id="onboarding-progress-title" className="font-semibold">
          {untouched
            ? "Configura tu negocio en un minuto"
            : "Termina de configurar tu negocio"}
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          {progress.label}. Te falta:{" "}
          {new Intl.ListFormat("es", {
            style: "long",
            type: "conjunction",
          }).format(pending.map((entry) => entry.label.toLowerCase()))}
          .
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button asChild>
          <Link href="/onboarding">{untouched ? "Empezar" : "Continuar"}</Link>
        </Button>
        {progress.missingToIssue.length === 0 ? (
          <Button type="button" variant="ghost" onClick={dismiss}>
            Ahora no
          </Button>
        ) : null}
      </div>
    </aside>
  );
}

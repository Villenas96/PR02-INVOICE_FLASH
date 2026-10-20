"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

import { apiRequest, jsonRequest } from "@/lib/api/client";

interface AccessibleCompany {
  company_id: string;
  legal_name: string | null;
  role: "owner" | "advisor";
  suspended: boolean;
}

/**
 * Active company selector for advisors (FR-052). Hidden when the account
 * only has its own company.
 */
export function CompanySwitcher({
  activeCompanyId,
}: {
  activeCompanyId: string | null;
}) {
  const router = useRouter();
  const id = useId();
  const [companies, setCompanies] = useState<AccessibleCompany[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<{ items: AccessibleCompany[] }>("/api/v1/me/companies")
      .then((page) => setCompanies(page.items))
      .catch(() => setCompanies([]));
  }, []);

  if (
    companies.length < 2 &&
    companies.every((item) => item.role === "owner")
  ) {
    return null;
  }

  async function switchTo(companyId: string) {
    try {
      await apiRequest(
        "/api/v1/me/active-company",
        jsonRequest("PUT", { company_id: companyId }),
      );
      setError(null);
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("No se ha podido cambiar de empresa.");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        Empresa
      </label>
      <select
        id={id}
        className="h-8 max-w-48 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        value={activeCompanyId ?? ""}
        onChange={(event) => void switchTo(event.target.value)}
      >
        {companies.map((company) => (
          <option key={company.company_id} value={company.company_id}>
            {company.legal_name ?? "Sin nombre"}
            {company.role === "owner" ? " (tuya)" : ""}
            {company.suspended ? " · en pausa" : ""}
          </option>
        ))}
      </select>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}

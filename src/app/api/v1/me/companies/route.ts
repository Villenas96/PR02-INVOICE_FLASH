import { runRoute } from "@/lib/api/route";
import { listMyCompanies } from "@/services/advisor-access";
import { requireSession } from "@/services/context";

/** Companies the account can act on: its own and advised ones (FR-052). */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, "me.companies_failed", async () => {
    const session = await requireSession(request);
    const companies = await listMyCompanies({ userId: session.userId });
    return Response.json({
      items: companies.map((company) => ({
        company_id: company.companyId,
        legal_name: company.legalName,
        role: company.role,
        suspended: company.suspended,
      })),
    });
  });
}

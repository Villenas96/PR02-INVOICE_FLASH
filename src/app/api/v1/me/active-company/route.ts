import { z } from "zod";

import { runRoute } from "@/lib/api/route";
import { parseJson } from "@/lib/api/validate";
import { setActiveCompany } from "@/services/advisor-access";
import { requireSession } from "@/services/context";

const schema = z.object({ company_id: z.string().uuid() }).strict();

/** Switches the session's active company (FR-052). */
export async function PUT(request: Request): Promise<Response> {
  return runRoute(request, "me.active_company_failed", async () => {
    const [session, input] = await Promise.all([
      requireSession(request),
      parseJson(request, schema),
    ]);
    await setActiveCompany({
      userId: session.userId,
      sessionId: session.sessionId,
      companyId: input.company_id,
    });
    return Response.json({ company_id: input.company_id });
  });
}

import { z } from "zod";

import { runRoute } from "@/lib/api/route";
import { validate } from "@/lib/api/validate";
import { revokeAdvisorAccess } from "@/services/advisor-access";
import { resolveCompanyContext } from "@/services/context";

const paramsSchema = z.object({ id: z.string().uuid() }).strict();

/** Revokes with immediate effect (FR-050). */
export async function DELETE(
  request: Request,
  routeContext: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runRoute(request, "advisor_access.revoke_failed", async () => {
    const params = validate(paramsSchema, await routeContext.params);
    const context = await resolveCompanyContext(request, { access: "write" });
    await revokeAdvisorAccess({ context, accessId: params.id });
    return new Response(null, { status: 204 });
  });
}

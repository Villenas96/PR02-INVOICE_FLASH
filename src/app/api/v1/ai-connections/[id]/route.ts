import { z } from "zod";

import { runRoute } from "@/lib/api/route";
import { validate } from "@/lib/api/validate";
import { requireOwner, resolveCompanyContext } from "@/services/context";
import { revokeAiConnection } from "@/services/mcp/connections";

const paramsSchema = z.object({ id: z.string().uuid() }).strict();

/** Revokes the assistant with immediate effect (FR-054). */
export async function DELETE(
  request: Request,
  routeContext: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runRoute(request, "ai_connections.revoke_failed", async () => {
    const params = validate(paramsSchema, await routeContext.params);
    const context = await resolveCompanyContext(request, { access: "write" });
    requireOwner(context);
    await revokeAiConnection({ context, connectionId: params.id });
    return new Response(null, { status: 204 });
  });
}

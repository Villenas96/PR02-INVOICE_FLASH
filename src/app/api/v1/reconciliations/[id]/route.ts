import { z } from "zod";

import { runRoute } from "@/lib/api/route";
import { validate } from "@/lib/api/validate";
import { deleteReconciliation } from "@/services/bank/reconciliation";
import { resolveCompanyContext } from "@/services/context";

const paramsSchema = z.object({ id: z.string().uuid() }).strict();

/** Undo: removes the allocation and the payment it created. */
export async function DELETE(
  request: Request,
  route: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runRoute(request, "reconciliations.delete_failed", async () => {
    const context = await resolveCompanyContext(request, { access: "write" });
    const params = validate(paramsSchema, await route.params);
    await deleteReconciliation({ context, reconciliationId: params.id });
    return new Response(null, { status: 204 });
  });
}

import { z } from "zod";

import { runRoute } from "@/lib/api/route";
import { parseJson, validate } from "@/lib/api/validate";
import { setTransactionIgnored } from "@/services/bank/reconciliation";
import { resolveCompanyContext } from "@/services/context";

const paramsSchema = z.object({ id: z.string().uuid() }).strict();
const bodySchema = z.object({ ignored: z.boolean() }).strict();

/** Ignore or restore a movement that is not an invoice payment. */
export async function PATCH(
  request: Request,
  route: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runRoute(request, "bank_transactions.update_failed", async () => {
    const context = await resolveCompanyContext(request, { access: "write" });
    const [params, input] = await Promise.all([
      route.params.then((value) => validate(paramsSchema, value)),
      parseJson(request, bodySchema),
    ]);
    await setTransactionIgnored({
      context,
      transactionId: params.id,
      ignored: input.ignored,
    });
    return Response.json({ id: params.id, ignored: input.ignored });
  });
}

import { z } from "zod";

import { createDatabase } from "@/db";
import { runRoute } from "@/lib/api/route";
import { parseJson, validate } from "@/lib/api/validate";
import { resolveCompanyContext } from "@/services/context";
import { decideQuote } from "@/services/quote-decision";

const paramsSchema = z.object({ id: z.string().uuid() }).strict();
const bodySchema = z
  .object({ decision: z.enum(["accepted", "rejected"]) })
  .strict();

/** `{decision}` on an issued, non-voided quote (FR-035). */
export async function POST(
  request: Request,
  routeContext: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runRoute(request, "documents.quote_decision_failed", async () => {
    const [context, params, input] = await Promise.all([
      resolveCompanyContext(request, { access: "write" }),
      routeContext.params.then((value) => validate(paramsSchema, value)),
      parseJson(request, bodySchema),
    ]);
    const decided = await decideQuote({
      database: createDatabase(),
      companyId: context.companyId,
      documentId: params.id,
      actor: context.userId,
      decision: input.decision,
    });
    return Response.json({
      id: params.id,
      quote_decision: decided.decision,
      quote_decided_at: decided.decidedAt,
    });
  });
}

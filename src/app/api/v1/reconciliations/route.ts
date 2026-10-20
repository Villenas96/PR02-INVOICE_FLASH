import { parseIdempotencyKey } from "@/lib/api/idempotency";
import { runRoute } from "@/lib/api/route";
import { parseJson } from "@/lib/api/validate";
import {
  createReconciliation,
  createReconciliationSchema,
} from "@/services/bank/reconciliation";
import { resolveCompanyContext } from "@/services/context";

/**
 * Allocates a movement to one or more invoices and registers the payments
 * (FR-045). Requires `Idempotency-Key`.
 */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, "reconciliations.create_failed", async () => {
    const context = await resolveCompanyContext(request, { access: "write" });
    const data = await parseJson(request, createReconciliationSchema);
    const idempotencyKey = parseIdempotencyKey(request, true) as string;
    const created = await createReconciliation({
      context,
      data,
      idempotencyKey,
    });
    return Response.json(
      { reconciliation_ids: created.reconciliationIds },
      { status: 201 },
    );
  });
}

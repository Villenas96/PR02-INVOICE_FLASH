import { z } from "zod";

import { parsePagination } from "@/lib/api/pagination";
import { runRoute } from "@/lib/api/route";
import { validate } from "@/lib/api/validate";
import { listBankTransactions } from "@/services/bank/reconciliation";
import { resolveCompanyContext } from "@/services/context";

const querySchema = z
  .object({
    status: z.enum(["pending", "partial", "reconciled", "ignored"]).optional(),
    limit: z.string().optional(),
    cursor: z.string().optional(),
  })
  .strict();

export async function GET(request: Request): Promise<Response> {
  return runRoute(request, "bank_transactions.list_failed", async () => {
    const searchParams = new URL(request.url).searchParams;
    const query = validate(querySchema, Object.fromEntries(searchParams));
    const pagination = parsePagination(searchParams);
    const context = await resolveCompanyContext(request, { access: "read" });
    const page = await listBankTransactions({
      context,
      status: query.status,
      limit: pagination.limit,
      cursor: pagination.cursor,
    });
    return Response.json({
      items: page.items.map((item) => ({
        id: item.id,
        operation_on: item.operationOn,
        value_on: item.valueOn,
        amount_cents: item.amountCents,
        concept: item.concept,
        status: item.status,
        allocated_cents: item.allocatedCents,
        collection_method_id: item.collectionMethodId,
        reconciliations: item.reconciliations.map((link) => ({
          id: link.id,
          document_id: link.documentId,
          document_number: link.documentNumber,
          amount_cents: link.amountCents,
        })),
      })),
      next_cursor: page.nextCursor,
    });
  });
}

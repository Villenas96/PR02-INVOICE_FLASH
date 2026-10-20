import { runRoute } from "@/lib/api/route";
import { reconciliationSuggestions } from "@/services/bank/reconciliation";
import { resolveCompanyContext } from "@/services/context";

/** Ranked match suggestions for unmatched income (FR-044). */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, "reconciliation.suggestions_failed", async () => {
    const context = await resolveCompanyContext(request, { access: "read" });
    const suggestions = await reconciliationSuggestions({ context });
    return Response.json({
      items: suggestions.map((suggestion) => ({
        bank_transaction_id: suggestion.transactionId,
        document_id: suggestion.documentId,
        score: suggestion.score,
        confidence: suggestion.confidence,
        allocation_cents: suggestion.allocationCents,
        reasons: suggestion.reasons,
        transaction: {
          operation_on: suggestion.transaction.operationOn,
          concept: suggestion.transaction.concept,
          amount_cents: suggestion.transaction.amountCents,
        },
        invoice: {
          full_number: suggestion.invoice.fullNumber,
          client_name: suggestion.invoice.clientName,
          pending_cents: suggestion.invoice.pendingCents,
        },
      })),
    });
  });
}

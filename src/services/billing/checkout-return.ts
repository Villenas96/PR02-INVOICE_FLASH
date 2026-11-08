import type { Database } from "@/db";
import { toApiError } from "@/lib/api/errors";
import { logSafe } from "@/lib/log";
import { notifyPlanChange } from "@/services/billing/notify";
import { reconcileSubscription } from "@/services/billing/reconcile";
import type { StripeClient } from "@/services/billing/stripe";
import {
  issueDocument,
  type PdfRenderQueue,
} from "@/services/document-issuance";

export interface CheckoutReturnInput {
  companyId: string;
  userId: string;
  sessionId: string;
  resumeDocumentId?: string;
}

export interface CheckoutReturnDependencies {
  database: Database;
  stripe: StripeClient;
  pdfQueue: PdfRenderQueue;
  notify?: boolean;
  now?: Date;
}

export type CheckoutReturnOutcome =
  | { kind: "invalid_session" }
  | { kind: "activated" }
  | { kind: "issued"; documentId: string }
  | { kind: "resume_failed"; documentId: string; code: string };

/**
 * Checkout success return (research R1, SC-002): sync the session with the
 * Stripe API instead of waiting for the webhook, then retry issuing the
 * draft that hit the quota so the user never redoes it. The draft is issued
 * through the common guard: if the plan is still not effective it stays a
 * numberless draft.
 */
export async function completeCheckoutReturn(
  input: CheckoutReturnInput,
  dependencies: CheckoutReturnDependencies,
): Promise<CheckoutReturnOutcome> {
  const session = await dependencies.stripe.checkout.sessions
    .retrieve(input.sessionId)
    .catch(() => null);
  const customer =
    typeof session?.customer === "string"
      ? session.customer
      : (session?.customer?.id ?? null);
  if (
    !session ||
    session.client_reference_id !== input.companyId ||
    !customer
  ) {
    return { kind: "invalid_session" };
  }

  const result = await reconcileSubscription(
    { companyId: input.companyId, stripeCustomerId: customer },
    {
      database: dependencies.database,
      stripe: dependencies.stripe,
      reason: "checkout",
      now: dependencies.now,
    },
  );
  if (dependencies.notify !== false) {
    try {
      await notifyPlanChange(dependencies.database, result);
    } catch (error) {
      // The webhook will notify; never fail the return page over an email.
      logSafe("warn", "billing.return_notice_failed", {
        error_type: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  if (!input.resumeDocumentId) {
    return { kind: "activated" };
  }
  try {
    await issueDocument(
      {
        companyId: input.companyId,
        documentId: input.resumeDocumentId,
        actor: input.userId,
      },
      {
        database: dependencies.database,
        queue: dependencies.pdfQueue,
        now: dependencies.now,
      },
    );
    return { kind: "issued", documentId: input.resumeDocumentId };
  } catch (error) {
    return {
      kind: "resume_failed",
      documentId: input.resumeDocumentId,
      code: toApiError(error).code,
    };
  }
}

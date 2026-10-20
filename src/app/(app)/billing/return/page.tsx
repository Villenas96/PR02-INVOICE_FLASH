import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createDatabase } from "@/db";
import { auth } from "@/lib/auth";
import { getQueue } from "@/lib/cloudflare";
import { completeCheckoutReturn } from "@/services/billing/checkout-return";
import { getStripeClient } from "@/services/billing/stripe";
import { getLayoutData } from "@/services/layout-data";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Stripe Checkout success URL. The work happens on the server before the
 * redirect; `loading.tsx` shows progress meanwhile (SC-002).
 */
export default async function BillingReturnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }
  const params = await searchParams;
  const sessionId = firstValue(params.session_id);
  const resume = firstValue(params.resume);
  const company = await getLayoutData(session.user.id, session.session.id);
  if (!sessionId || !company) {
    redirect("/billing");
  }

  const outcome = await completeCheckoutReturn(
    {
      companyId: company.company.id,
      userId: session.user.id,
      sessionId,
      resumeDocumentId:
        resume && UUID_PATTERN.test(resume) ? resume : undefined,
    },
    {
      database: createDatabase(),
      stripe: getStripeClient(),
      pdfQueue: await getQueue("PDF_RENDER_QUEUE"),
    },
  );

  switch (outcome.kind) {
    case "issued":
      redirect(`/documents/${outcome.documentId}?upgraded=1`);
      break;
    case "resume_failed":
      redirect(`/documents/${outcome.documentId}?upgrade_pending=1`);
      break;
    case "activated":
      redirect("/billing?activated=1");
      break;
    case "invalid_session":
      redirect("/billing");
  }
}

import { and, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { companies } from "@/db/schema/company";
import { documents } from "@/db/schema/document";
import { payments } from "@/db/schema/payment";
import { shareLinks } from "@/db/schema/share-link";
import { formatIban } from "@/lib/iban";
import { madridDate } from "@/lib/plan";
import type { RenderedEmail } from "@/services/email/templates/layout";
import {
  type PaymentReminderInput,
  renderPaymentReminder,
} from "@/services/email/templates/reminder";

interface MethodSnapshot {
  label?: string;
  holder?: string;
  iban?: string;
  bic?: string;
  phone?: string;
  email_or_url?: string;
  instructions?: string;
}

function paymentLines(snapshot: MethodSnapshot | null): string[] {
  if (!snapshot) {
    return [];
  }
  return [
    snapshot.label,
    snapshot.holder ? `Titular: ${snapshot.holder}` : null,
    snapshot.iban ? `IBAN: ${formatIban(snapshot.iban)}` : null,
    snapshot.bic ? `BIC: ${snapshot.bic}` : null,
    snapshot.phone ? `Bizum: ${snapshot.phone}` : null,
    snapshot.email_or_url ? `PayPal: ${snapshot.email_or_url}` : null,
    snapshot.instructions,
  ].filter((line): line is string => Boolean(line));
}

/**
 * Renders a payment reminder from the stored invoice at send time: the
 * queue and the delivery payload carry only ids, never amounts or IBANs.
 */
export async function renderReminderEmail(
  database: Database,
  documentId: string,
  appBaseUrl: string,
  now: Date,
): Promise<RenderedEmail | null> {
  const [document] = await database
    .select({
      number: documents.fullNumber,
      dueDate: documents.dueDate,
      totalCents: documents.totalCents,
      method: documents.collectionMethodSnapshot,
      issuer: companies.legalName,
      paidCents: sql<number>`coalesce((
        SELECT sum(${payments.amountCents}) FROM ${payments}
        WHERE ${payments.documentId} = ${documents.id}
      ), 0)::integer`,
    })
    .from(documents)
    .innerJoin(companies, eq(companies.id, documents.companyId))
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)));
  if (!document?.number) {
    return null;
  }
  const [link] = await database
    .select({ token: shareLinks.token })
    .from(shareLinks)
    .where(
      and(eq(shareLinks.documentId, documentId), isNull(shareLinks.disabledAt)),
    );
  const input: PaymentReminderInput = {
    issuerName: document.issuer ?? "tu proveedor",
    documentNumber: document.number,
    dueDate: document.dueDate,
    pendingCents: Math.max(document.totalCents - document.paidCents, 0),
    paymentLines: paymentLines(document.method as MethodSnapshot | null),
    publicUrl: link ? new URL(`/d/${link.token}`, appBaseUrl).toString() : null,
    today: madridDate(now),
  };
  return renderPaymentReminder(input);
}

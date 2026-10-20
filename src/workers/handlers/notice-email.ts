import { and, eq, inArray, sql } from "drizzle-orm";

import { createDatabase, type Database } from "@/db";
import { emailDeliveries } from "@/db/schema/email-delivery";
import {
  advisorInviteSeed,
  deriveSignedToken,
  exportTokenSeed,
} from "@/lib/download-tokens";
import {
  type NotificationPayload,
  renderNotification,
} from "@/lib/notifications";
import { planLabel, type StoredPlan } from "@/lib/plan";
import {
  renderAdvisorExport,
  renderAdvisorInvite,
} from "@/services/email/templates/advisor";
import {
  BILLING_NOTICE_TEMPLATES,
  type BillingNoticeTemplate,
  renderBillingNotice,
} from "@/services/email/templates/billing";
import {
  paragraph,
  type RenderedEmail,
  renderEmailLayout,
} from "@/services/email/templates/layout";
import { renderReminderEmail } from "@/services/reminder-email";
import type { TransactionalEmailProvider } from "@/workers/handlers/email-send";
import {
  EMAIL_RETRY_WINDOW_MS,
  type EmailSendMessage,
} from "@/workers/messages";
import { RetryableQueueError } from "@/workers/queue-consumer";

export const NOTICE_PURPOSES = [
  "billing_notice",
  "user_notice",
  "advisor_invite",
  "advisor_export",
  "payment_reminder",
] as const;

/** Template of `user_notice` deliveries: the in-app notice by email. */
export const USER_NOTIFICATION_TEMPLATE = "user_notification";
export type NoticeDeliveryPurpose = (typeof NOTICE_PURPOSES)[number];

export interface NoticeEmailDependencies {
  database?: Database;
  provider: TransactionalEmailProvider;
  appBaseUrl: string;
  /** Rebuilds signed links (exports, invitations) from opaque ids. */
  tokenSecret?: () => string;
  now?: () => Date;
}

export interface RenderNoticeContext {
  appBaseUrl: string;
  database?: Database;
  now?: Date;
  tokenSecret?: () => string;
}

type Payload = Record<string, unknown> | null;

function stringField(payload: Payload, key: string): string | null {
  const value = payload?.[key];
  return typeof value === "string" ? value : null;
}

/**
 * Renders a notice from its stored template name and non-sensitive
 * payload. Unknown templates are a programming error, never a retry.
 */
export async function renderNotice(
  template: string | null,
  payload: Payload,
  context: RenderNoticeContext,
): Promise<RenderedEmail | null> {
  const { appBaseUrl } = context;
  if (
    template &&
    (BILLING_NOTICE_TEMPLATES as readonly string[]).includes(template)
  ) {
    const plan = stringField(payload, "plan") as StoredPlan | null;
    const graceUntil = stringField(payload, "grace_until");
    return renderBillingNotice(template as BillingNoticeTemplate, {
      planLabel: plan ? planLabel(plan) : "de pago",
      graceUntil: graceUntil ? new Date(graceUntil) : null,
      billingUrl: new URL("/billing", appBaseUrl).toString(),
    });
  }
  if (template === USER_NOTIFICATION_TEMPLATE) {
    const kind = stringField(payload, "kind");
    if (!kind) {
      return null;
    }
    const notice = renderNotification(
      kind,
      (payload ?? {}) as NotificationPayload,
    );
    const url = new URL(notice.href ?? "/dashboard", appBaseUrl).toString();
    return {
      subject: notice.title,
      text: `${notice.body}\n\nAbrir Invoice Flash: ${url}`,
      html: renderEmailLayout({
        title: notice.title,
        bodyHtml: paragraph(notice.body),
        action: { label: "Abrir Invoice Flash", url },
      }),
    };
  }
  if (template === "payment_reminder") {
    const documentId = stringField(payload, "document_id");
    if (!documentId || !context.database) {
      return null;
    }
    return renderReminderEmail(
      context.database,
      documentId,
      appBaseUrl,
      context.now ?? new Date(),
    );
  }
  if (template === "advisor_invite" || template === "advisor_export") {
    return renderAdvisorNotice(template, payload, context);
  }
  return null;
}

async function renderAdvisorNotice(
  template: "advisor_invite" | "advisor_export",
  payload: Payload,
  context: RenderNoticeContext,
): Promise<RenderedEmail | null> {
  const companyName = stringField(payload, "company_name") ?? "Tu cliente";
  const expiresAt = stringField(payload, "expires_at");
  if (!context.tokenSecret || !expiresAt) {
    return null;
  }
  if (template === "advisor_invite") {
    const accessId = stringField(payload, "access_id");
    if (!accessId) {
      return null;
    }
    const { token } = await deriveSignedToken(
      context.tokenSecret(),
      advisorInviteSeed(accessId),
    );
    const acceptUrl = new URL("/advisor/accept", context.appBaseUrl);
    acceptUrl.searchParams.set("token", token);
    return renderAdvisorInvite({
      companyName,
      acceptUrl: acceptUrl.toString(),
      expiresAt: new Date(expiresAt),
    });
  }
  const exportId = stringField(payload, "export_id");
  if (!exportId) {
    return null;
  }
  const { token } = await deriveSignedToken(
    context.tokenSecret(),
    exportTokenSeed(exportId),
  );
  return renderAdvisorExport({
    companyName,
    periodLabel: stringField(payload, "period_label"),
    downloadUrl: new URL(`/x/${token}`, context.appBaseUrl).toString(),
    expiresAt: new Date(expiresAt),
  });
}

async function markNotice(
  database: Database,
  deliveryId: string,
  values: Partial<typeof emailDeliveries.$inferInsert>,
): Promise<void> {
  await database
    .update(emailDeliveries)
    .set(values)
    .where(
      and(
        eq(emailDeliveries.id, deliveryId),
        eq(emailDeliveries.status, "sending"),
      ),
    );
}

/** Sends billing (and later advisor/user) notices to the account owner. */
export function createNoticeEmailHandler(
  dependencies: NoticeEmailDependencies,
): (message: EmailSendMessage) => Promise<void> {
  return async (message) => {
    const database = dependencies.database ?? createDatabase();
    const now = dependencies.now?.() ?? new Date();
    const [claimed] = await database
      .update(emailDeliveries)
      .set({
        status: "sending",
        attemptCount: sql`${emailDeliveries.attemptCount} + 1`,
        lastErrorCode: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(emailDeliveries.id, message.deliveryId),
          inArray(emailDeliveries.status, ["queued", "failed"]),
          inArray(emailDeliveries.purpose, [...NOTICE_PURPOSES]),
        ),
      )
      .returning({
        id: emailDeliveries.id,
        template: emailDeliveries.template,
        payload: emailDeliveries.payload,
        recipientEmail: emailDeliveries.recipientEmail,
        createdAt: emailDeliveries.createdAt,
      });

    if (!claimed) {
      return;
    }
    const rendered = await renderNotice(
      claimed.template,
      claimed.payload as Payload,
      { ...dependencies, database, now },
    );
    if (!claimed.recipientEmail || !rendered) {
      await markNotice(database, claimed.id, {
        status: "failed",
        lastErrorCode: rendered ? "recipient_missing" : "template_unknown",
        updatedAt: now,
      });
      return;
    }

    const retryUntil = new Date(
      claimed.createdAt.getTime() + EMAIL_RETRY_WINDOW_MS,
    );
    try {
      const result = await dependencies.provider.send({
        to: claimed.recipientEmail,
        ...rendered,
        idempotencyKey: `email/${claimed.id}`,
      });
      await markNotice(database, claimed.id, {
        status: "sent",
        providerMessageId: result.id,
        sentAt: now,
        updatedAt: now,
      });
    } catch {
      await markNotice(database, claimed.id, {
        status: "failed",
        lastErrorCode: "provider_unavailable",
        updatedAt: now,
      });
      throw new RetryableQueueError(
        "El proveedor de correo no está disponible.",
        retryUntil,
      );
    }
  };
}

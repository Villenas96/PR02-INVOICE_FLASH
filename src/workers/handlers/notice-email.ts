import { and, eq, inArray, sql } from "drizzle-orm";

import { createDatabase, type Database } from "@/db";
import { emailDeliveries } from "@/db/schema/email-delivery";
import {
  type NotificationPayload,
  renderNotification,
} from "@/lib/notifications";
import { planLabel, type StoredPlan } from "@/lib/plan";
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
import type { TransactionalEmailProvider } from "@/workers/handlers/email-send";
import {
  EMAIL_RETRY_WINDOW_MS,
  type EmailSendMessage,
} from "@/workers/messages";
import { RetryableQueueError } from "@/workers/queue-consumer";

export const NOTICE_PURPOSES = ["billing_notice", "user_notice"] as const;

/** Template of `user_notice` deliveries: the in-app notice by email. */
export const USER_NOTIFICATION_TEMPLATE = "user_notification";
export type NoticeDeliveryPurpose = (typeof NOTICE_PURPOSES)[number];

export interface NoticeEmailDependencies {
  database?: Database;
  provider: TransactionalEmailProvider;
  appBaseUrl: string;
  now?: () => Date;
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
export function renderNotice(
  template: string | null,
  payload: Payload,
  appBaseUrl: string,
): RenderedEmail | null {
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
  return null;
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
    const rendered = renderNotice(
      claimed.template,
      claimed.payload as Payload,
      dependencies.appBaseUrl,
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

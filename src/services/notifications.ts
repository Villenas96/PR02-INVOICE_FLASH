import { and, count, desc, eq, isNull, lt } from "drizzle-orm";

import { createDatabase, type Database } from "@/db";
import { companies } from "@/db/schema/company";
import { userNotifications } from "@/db/schema/user-notification";
import { decodeIdCursor, encodeIdCursor } from "@/lib/api/pagination";
import { createUuidV7 } from "@/lib/ids";
import {
  assertSafeNotificationPayload,
  type NotificationKind,
  type NotificationPayload,
  type RenderedNotification,
  renderNotification,
} from "@/lib/notifications";
import { ResourceNotFoundError } from "@/services/context";
import type { EmailQueue } from "@/services/email/auth-deliveries";
import { enqueueNotice } from "@/services/email/notices";
import { USER_NOTIFICATION_TEMPLATE } from "@/workers/handlers/notice-email";

export interface CreateNotificationInput {
  database?: Database;
  companyId: string;
  /** Defaults to the company owner. */
  userId?: string;
  kind: NotificationKind;
  payload: NotificationPayload;
  /** Per origin, e.g. `recurring_cycle:{id}`: redeliveries never duplicate. */
  idempotencyKey: string;
  /** Critical notices are also emailed to the owner (allowed in all plans). */
  email?: { queue: EmailQueue };
  now?: Date;
}

/** Returns the new notification id, or `null` if the key already existed. */
export async function createNotification(
  input: CreateNotificationInput,
): Promise<string | null> {
  assertSafeNotificationPayload(input.payload);
  const database = input.database ?? createDatabase();
  const now = input.now ?? new Date();
  let userId = input.userId;
  if (!userId) {
    const [owner] = await database
      .select({ userId: companies.userId })
      .from(companies)
      .where(eq(companies.id, input.companyId))
      .limit(1);
    if (!owner) {
      return null;
    }
    userId = owner.userId;
  }

  const [created] = await database
    .insert(userNotifications)
    .values({
      id: createUuidV7(now.getTime()),
      companyId: input.companyId,
      userId,
      kind: input.kind,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
    })
    .onConflictDoNothing({ target: userNotifications.idempotencyKey })
    .returning({ id: userNotifications.id });

  if (created && input.email) {
    await enqueueNotice({
      database,
      queue: input.email.queue,
      purpose: "user_notice",
      template: USER_NOTIFICATION_TEMPLATE,
      companyId: input.companyId,
      idempotencyKey: `user_notice:${input.idempotencyKey}`,
      payload: { ...input.payload, kind: input.kind },
      now,
    });
  }
  return created?.id ?? null;
}

export interface NotificationView extends RenderedNotification {
  id: string;
  kind: string;
  readAt: Date | null;
  createdAt: Date;
}

export async function listNotifications(input: {
  database?: Database;
  userId: string;
  companyId: string;
  unreadOnly: boolean;
  limit: number;
  cursor?: string;
}): Promise<{
  items: NotificationView[];
  nextCursor: string | null;
  unreadCount: number;
}> {
  const database = input.database ?? createDatabase();
  const afterId = decodeIdCursor(input.cursor);
  const scope = and(
    eq(userNotifications.userId, input.userId),
    eq(userNotifications.companyId, input.companyId),
  );
  const rows = await database
    .select()
    .from(userNotifications)
    .where(
      and(
        scope,
        input.unreadOnly ? isNull(userNotifications.readAt) : undefined,
        afterId ? lt(userNotifications.id, afterId) : undefined,
      ),
    )
    .orderBy(desc(userNotifications.id))
    .limit(input.limit + 1);
  const [unread] = await database
    .select({ value: count() })
    .from(userNotifications)
    .where(and(scope, isNull(userNotifications.readAt)));

  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      id: row.id,
      kind: row.kind,
      readAt: row.readAt,
      createdAt: row.createdAt,
      ...renderNotification(row.kind, row.payload as NotificationPayload),
    })),
    nextCursor:
      rows.length > input.limit && last ? encodeIdCursor(last.id) : null,
    unreadCount: unread?.value ?? 0,
  };
}

/** Marks one of the user's own notices as read; anyone else's is a 404. */
export async function markNotificationRead(input: {
  database?: Database;
  userId: string;
  notificationId: string;
  now?: Date;
}): Promise<void> {
  const database = input.database ?? createDatabase();
  const [own] = await database
    .select({ id: userNotifications.id, readAt: userNotifications.readAt })
    .from(userNotifications)
    .where(
      and(
        eq(userNotifications.id, input.notificationId),
        eq(userNotifications.userId, input.userId),
      ),
    )
    .limit(1);
  if (!own) {
    throw new ResourceNotFoundError();
  }
  if (!own.readAt) {
    await database
      .update(userNotifications)
      .set({ readAt: input.now ?? new Date() })
      .where(eq(userNotifications.id, own.id));
  }
}

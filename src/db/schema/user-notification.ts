import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { companies } from "./company";

/**
 * In-app notice for the user (research R21): generated cycles, failed
 * recurrences, finished exports… The payload never holds NIF, IBAN,
 * amounts or emails.
 */
export const userNotifications = pgTable(
  "user_notification",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("user_notification_idempotency_key_unique").on(
      table.idempotencyKey,
    ),
    index("user_notification_user_read_created_idx").on(
      table.userId,
      table.readAt,
      table.createdAt,
    ),
  ],
);

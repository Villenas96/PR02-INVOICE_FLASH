import { sql } from "drizzle-orm";
import {
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { companies } from "./company";

export const accessEventActionEnum = pgEnum("access_event_action", [
  "session_started",
  "exported",
  "downloaded_pdf",
  "access_revoked",
]);

/** Advisor audit trail (FR-053): INSERT only. */
export const accessEvents = pgTable(
  "access_event",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    action: accessEventActionEnum("action").notNull(),
    targetId: uuid("target_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("access_event_company_created_at_idx").on(
      table.companyId,
      table.createdAt,
    ),
    // `session_started` at most once per user, company and Madrid day.
    uniqueIndex("access_event_session_started_daily_unique")
      .on(
        table.companyId,
        table.actorUserId,
        sql`((${table.createdAt} AT TIME ZONE 'Europe/Madrid')::date)`,
      )
      .where(sql`${table.action} = 'session_started'`),
  ],
);

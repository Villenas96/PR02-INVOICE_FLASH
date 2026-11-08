import { sql } from "drizzle-orm";
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { companies } from "./company";
import { oauthClients } from "./oauth";

export const aiConnectionStatusEnum = pgEnum("ai_connection_status", [
  "active",
  "revoked",
]);

/**
 * An AI assistant the owner connected to one company (FR-054). It wraps the
 * OAuth client: every MCP request checks it is still `active` and that the
 * company still has Pro, so revoking or downgrading takes effect at once.
 */
export const aiConnections = pgTable(
  "ai_connection",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    oauthClientId: text("oauth_client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    clientName: text("client_name").notNull(),
    status: aiConnectionStatusEnum("status").notNull().default("active"),
    authorizedAt: timestamp("authorized_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    // One live connection per user and assistant; re-authorising after a
    // revocation creates a new row and keeps the history.
    uniqueIndex("ai_connection_active_unique")
      .on(table.userId, table.oauthClientId)
      .where(sql`${table.status} = 'active'`),
    index("ai_connection_company_idx").on(table.companyId, table.status),
  ],
);

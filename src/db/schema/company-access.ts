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

export const companyAccessRoleEnum = pgEnum("company_access_role", ["advisor"]);
export const companyAccessStatusEnum = pgEnum("company_access_status", [
  "pending",
  "active",
  "revoked",
]);

/**
 * Read-only access of an advisor (gestoría) to a company (FR-050–053).
 * `suspended` is never stored: it is derived when the company lacks Pro.
 */
export const companyAccess = pgTable(
  "company_access",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    /** `null` until the invitation is accepted. */
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    role: companyAccessRoleEnum("role").notNull().default("advisor"),
    status: companyAccessStatusEnum("status").notNull().default("pending"),
    /** SHA-256 of the normalized email; the clear email lives only in
     * `email_delivery` (30-day retention). */
    invitedEmailHash: text("invited_email_hash").notNull(),
    inviteTokenHash: text("invite_token_hash").notNull(),
    inviteExpiresAt: timestamp("invite_expires_at", {
      withTimezone: true,
    }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("company_access_invite_token_hash_unique").on(
      table.inviteTokenHash,
    ),
    uniqueIndex("company_access_company_user_active_unique")
      .on(table.companyId, table.userId)
      .where(sql`${table.status} = 'active'`),
    index("company_access_user_status_idx").on(table.userId, table.status),
    index("company_access_company_status_idx").on(
      table.companyId,
      table.status,
    ),
  ],
);

import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { aiConnections } from "./ai-connection";
import { documents } from "./document";

export const aiConfirmationActionEnum = pgEnum("ai_confirmation_action", [
  "issue",
  "void",
]);

/**
 * Single-use confirmation of an irreversible AI action (FR-056). Only the
 * SHA-256 of the token is stored; it is valid 5 minutes and used once.
 */
export const aiConfirmations = pgTable(
  "ai_confirmation",
  {
    id: uuid("id").primaryKey(),
    aiConnectionId: uuid("ai_connection_id")
      .notNull()
      .references(() => aiConnections.id, { onDelete: "cascade" }),
    action: aiConfirmationActionEnum("action").notNull(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "restrict" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("ai_confirmation_connection_idx").on(
      table.aiConnectionId,
      table.createdAt,
    ),
  ],
);

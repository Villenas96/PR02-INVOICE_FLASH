import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users, verifications } from "./auth";
import { companies } from "./company";
import { documents } from "./document";

export const emailPurposeEnum = pgEnum("email_purpose", [
  "document",
  "verify_email",
  "reset_password",
]);
export const emailDeliveryStatusEnum = pgEnum("email_delivery_status", [
  "queued",
  "sending",
  "sent",
  "failed",
]);

export const emailDeliveries = pgTable(
  "email_delivery",
  {
    id: uuid("id").primaryKey(),
    purpose: emailPurposeEnum("purpose").notNull(),
    companyId: uuid("company_id").references(() => companies.id, {
      onDelete: "restrict",
    }),
    documentId: uuid("document_id").references(() => documents.id, {
      onDelete: "restrict",
    }),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    authVerificationId: uuid("auth_verification_id").references(
      () => verifications.id,
      {
        onDelete: "set null",
      },
    ),
    requestedBy: uuid("requested_by").references(() => users.id, {
      onDelete: "set null",
    }),
    idempotencyKey: text("idempotency_key").notNull(),
    recipientEmail: text("recipient_email"),
    recipientHash: text("recipient_hash").notNull(),
    customMessage: text("custom_message"),
    status: emailDeliveryStatusEnum("status").notNull().default("queued"),
    providerMessageId: text("provider_message_id"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("email_delivery_idempotency_key_unique").on(
      table.idempotencyKey,
    ),
    index("email_delivery_document_created_at_idx").on(
      table.documentId,
      table.createdAt,
    ),
    index("email_delivery_user_purpose_created_at_idx").on(
      table.userId,
      table.purpose,
      table.createdAt,
    ),
    index("email_delivery_status_created_at_idx").on(
      table.status,
      table.createdAt,
    ),
  ],
);

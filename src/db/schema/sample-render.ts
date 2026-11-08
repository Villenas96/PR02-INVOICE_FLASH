import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { companies } from "./company";

export const sampleRenderStatusEnum = pgEnum("sample_render_status", [
  "pending",
  "ready",
  "failed",
]);

/** Sample invoice PDF of the setup wizard (FR-049). Never a `document`. */
export const sampleRenders = pgTable(
  "sample_render",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    status: sampleRenderStatusEnum("status").notNull().default("pending"),
    fileKey: text("file_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("sample_render_company_created_idx").on(
      table.companyId,
      table.createdAt,
    ),
  ],
);

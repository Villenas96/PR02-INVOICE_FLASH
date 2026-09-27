import { and, eq } from "drizzle-orm";

import type { Database } from "@/db";
import { createDatabase } from "@/db";
import { documents } from "@/db/schema/document";
import { documentEvents } from "@/db/schema/document-event";
import { shareLinks } from "@/db/schema/share-link";
import { ApiError } from "@/lib/api/errors";
import { createUuidV7 } from "@/lib/ids";
import {
  createShareToken,
  decideShareLinkCreation,
  decideShareLinkDisable,
} from "@/lib/share-links";
import { ResourceNotFoundError } from "@/services/context";

export interface ShareLinkRecord {
  id: string;
  token: string;
  disabledAt: Date | null;
}

interface ShareLinkServiceInput {
  database?: Database;
  companyId: string;
  documentId: string;
  actor: string;
  now?: Date;
}

function notReadyError(): ApiError {
  return new ApiError(
    "conflict",
    409,
    "Solo puedes compartir documentos emitidos o anulados.",
  );
}

async function loadShareableDocument(
  database: Database,
  companyId: string,
  documentId: string,
): Promise<void> {
  const [document] = await database
    .select({ status: documents.status, deletedAt: documents.deletedAt })
    .from(documents)
    .where(
      and(eq(documents.id, documentId), eq(documents.companyId, companyId)),
    )
    .limit(1);

  if (!document || document.deletedAt) {
    throw new ResourceNotFoundError();
  }
  if (document.status === "draft") {
    throw notReadyError();
  }
}

async function loadExistingShareLink(
  database: Database,
  companyId: string,
  documentId: string,
): Promise<{ id: string; disabledAt: Date | null } | null> {
  const [existing] = await database
    .select({ id: shareLinks.id, disabledAt: shareLinks.disabledAt })
    .from(shareLinks)
    .where(
      and(
        eq(shareLinks.documentId, documentId),
        eq(shareLinks.companyId, companyId),
      ),
    )
    .limit(1);

  return existing ?? null;
}

async function insertLinkEvent(
  database: Database,
  input: {
    companyId: string;
    documentId: string;
    actor: string;
    event: "link_created" | "link_disabled";
    now: Date;
  },
): Promise<void> {
  await database.insert(documentEvents).values({
    id: createUuidV7(input.now.getTime()),
    companyId: input.companyId,
    documentId: input.documentId,
    actor: input.actor,
    event: input.event,
    createdAt: input.now,
  });
}

/**
 * Creates the document's one-and-only share link, or reactivates it if it
 * already exists (including an idempotent no-op when already active). The
 * token stays stable across disable/reactivate cycles.
 */
export async function createOrReactivateShareLink(
  input: ShareLinkServiceInput,
): Promise<ShareLinkRecord> {
  const database = input.database ?? createDatabase();
  const now = input.now ?? new Date();
  await loadShareableDocument(database, input.companyId, input.documentId);
  const existing = await loadExistingShareLink(
    database,
    input.companyId,
    input.documentId,
  );
  const decision = decideShareLinkCreation(existing);

  if (decision.action === "create") {
    const id = createUuidV7(now.getTime());
    const token = createShareToken();
    await database.insert(shareLinks).values({
      id,
      companyId: input.companyId,
      documentId: input.documentId,
      token,
      createdAt: now,
      updatedAt: now,
    });
    await insertLinkEvent(database, {
      companyId: input.companyId,
      documentId: input.documentId,
      actor: input.actor,
      event: "link_created",
      now,
    });
    return { id, token, disabledAt: null };
  }

  const wasDisabled = existing?.disabledAt !== null;
  const [updated] = await database
    .update(shareLinks)
    .set({ disabledAt: null, updatedAt: now })
    .where(eq(shareLinks.id, decision.id))
    .returning();

  if (!updated) {
    throw new ResourceNotFoundError();
  }
  if (wasDisabled) {
    await insertLinkEvent(database, {
      companyId: input.companyId,
      documentId: input.documentId,
      actor: input.actor,
      event: "link_created",
      now,
    });
  }

  return { id: updated.id, token: updated.token, disabledAt: null };
}

export async function disableShareLink(
  input: ShareLinkServiceInput,
): Promise<ShareLinkRecord> {
  const database = input.database ?? createDatabase();
  const now = input.now ?? new Date();
  await loadShareableDocument(database, input.companyId, input.documentId);
  const existing = await loadExistingShareLink(
    database,
    input.companyId,
    input.documentId,
  );
  const decision = decideShareLinkDisable(existing);

  if (decision.action === "not_found") {
    throw new ResourceNotFoundError();
  }

  const wasActive = existing?.disabledAt === null;
  const [updated] = await database
    .update(shareLinks)
    .set({ disabledAt: now, updatedAt: now })
    .where(eq(shareLinks.id, decision.id))
    .returning();

  if (!updated) {
    throw new ResourceNotFoundError();
  }
  if (wasActive) {
    await insertLinkEvent(database, {
      companyId: input.companyId,
      documentId: input.documentId,
      actor: input.actor,
      event: "link_disabled",
      now,
    });
  }

  return {
    id: updated.id,
    token: updated.token,
    disabledAt: updated.disabledAt,
  };
}

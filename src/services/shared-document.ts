import { and, eq, isNull } from "drizzle-orm";

import { createDatabase, type Database } from "@/db";
import { documents } from "@/db/schema/document";
import { shareLinks } from "@/db/schema/share-link";

export interface SharedDocumentRef {
  companyId: string;
  documentId: string;
  issuerLogoKey: string | null;
  clientLogoKey: string | null;
}

function logoKeyOf(snapshot: unknown): string | null {
  const key = (snapshot as { logoKey?: unknown } | null)?.logoKey;
  return typeof key === "string" && key.length > 0 ? key : null;
}

/**
 * Resolves an active public link to its (non-deleted) document. The token is
 * the only credential of the public view, so a disabled or unknown token is
 * indistinguishable from a missing document.
 */
export async function resolveSharedDocument(
  token: string,
  database: Database = createDatabase(),
): Promise<SharedDocumentRef | null> {
  const [row] = await database
    .select({
      companyId: documents.companyId,
      documentId: documents.id,
      deletedAt: documents.deletedAt,
      issuerSnapshot: documents.issuerSnapshot,
      clientSnapshot: documents.clientSnapshot,
    })
    .from(shareLinks)
    .innerJoin(documents, eq(documents.id, shareLinks.documentId))
    .where(and(eq(shareLinks.token, token), isNull(shareLinks.disabledAt)))
    .limit(1);
  if (!row || row.deletedAt) {
    return null;
  }
  return {
    companyId: row.companyId,
    documentId: row.documentId,
    issuerLogoKey: logoKeyOf(row.issuerSnapshot),
    clientLogoKey: logoKeyOf(row.clientSnapshot),
  };
}

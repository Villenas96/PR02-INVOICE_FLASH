import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Database } from "@/db";
import { documents } from "@/db/schema/document";
import { documentLinks } from "@/db/schema/document-link";
import type { DocumentType } from "@/lib/plan";

/**
 * Links between documents (FR-036, FR-037; research R4): conversions and
 * delivery notes billed by an invoice. Links are written inside the
 * statements that create the target; voiding an invoice releases its
 * `invoiced` links in the void statement itself.
 */

export interface DocumentLinkRef {
  id: string;
  kind: "converted" | "invoiced";
  documentType: DocumentType;
  fullNumber: string | null;
  status: "draft" | "issued" | "voided";
}

/**
 * Live links of a document: `from` are its sources (e.g. the proforma it was
 * converted from), `to` its targets, oldest first.
 */
export async function loadDocumentLinks(
  database: Database,
  companyId: string,
  documentId: string,
): Promise<{ from: DocumentLinkRef[]; to: DocumentLinkRef[] }> {
  const other = alias(documents, "linked_document");
  const rows = await database
    .select({
      sourceId: documentLinks.sourceDocumentId,
      targetId: documentLinks.targetDocumentId,
      kind: documentLinks.kind,
      id: other.id,
      documentType: other.documentType,
      fullNumber: other.fullNumber,
      status: other.status,
    })
    .from(documentLinks)
    .innerJoin(
      other,
      and(
        isNull(other.deletedAt),
        or(
          and(
            eq(documentLinks.sourceDocumentId, documentId),
            eq(other.id, documentLinks.targetDocumentId),
          ),
          and(
            eq(documentLinks.targetDocumentId, documentId),
            eq(other.id, documentLinks.sourceDocumentId),
          ),
        ),
      ),
    )
    .where(
      and(
        eq(documentLinks.companyId, companyId),
        isNull(documentLinks.releasedAt),
      ),
    )
    .orderBy(asc(documentLinks.createdAt));
  const ref = (row: (typeof rows)[number]): DocumentLinkRef => ({
    id: row.id,
    kind: row.kind,
    documentType: row.documentType,
    fullNumber: row.fullNumber,
    status: row.status,
  });
  return {
    from: rows.filter((row) => row.targetId === documentId).map(ref),
    to: rows.filter((row) => row.sourceId === documentId).map(ref),
  };
}

/** Live documents of `targetType` converted from `sourceId` (not deleted or voided). */
export async function liveConversions(
  database: Database,
  sourceId: string,
  targetType: DocumentType,
): Promise<Array<{ id: string; fullNumber: string | null }>> {
  return database
    .select({ id: documents.id, fullNumber: documents.fullNumber })
    .from(documentLinks)
    .innerJoin(documents, eq(documents.id, documentLinks.targetDocumentId))
    .where(
      and(
        eq(documentLinks.sourceDocumentId, sourceId),
        eq(documentLinks.kind, "converted"),
        isNull(documentLinks.releasedAt),
        eq(documents.documentType, targetType),
        isNull(documents.deletedAt),
        sql`${documents.status} <> 'voided'`,
      ),
    )
    .orderBy(asc(documentLinks.createdAt));
}

/** Live `invoiced` links of the given delivery notes. */
export async function liveInvoicing(
  database: Database,
  deliveryNoteIds: readonly string[],
): Promise<
  Array<{
    deliveryNoteId: string;
    invoiceId: string;
    invoiceNumber: string | null;
  }>
> {
  if (deliveryNoteIds.length === 0) {
    return [];
  }
  return database
    .select({
      deliveryNoteId: documentLinks.sourceDocumentId,
      invoiceId: documents.id,
      invoiceNumber: documents.fullNumber,
    })
    .from(documentLinks)
    .innerJoin(documents, eq(documents.id, documentLinks.targetDocumentId))
    .where(
      and(
        inArray(documentLinks.sourceDocumentId, [...deliveryNoteIds]),
        eq(documentLinks.kind, "invoiced"),
        isNull(documentLinks.releasedAt),
      ),
    );
}

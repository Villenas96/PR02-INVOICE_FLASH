import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { PrintableDocument } from "@/components/documents/printable-document";
import { createDatabase } from "@/db";
import { auth } from "@/lib/auth";
import { type DocumentDetail, getDocumentDetail } from "@/services/documents";
import { getLayoutData } from "@/services/layout-data";
import { printableFromDocument } from "@/services/printable";

import { AutoPrint } from "./auto-print";

/** Printable version of a document (FR-020). */
export default async function PrintDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }
  const [{ id }, summary] = await Promise.all([
    params,
    getLayoutData(session.user.id, session.session.id),
  ]);
  if (!summary) {
    notFound();
  }
  const document = await getDocumentDetail<DocumentDetail>({
    database: createDatabase(),
    companyId: summary.company.id,
    documentId: id,
  }).catch(() => null);
  if (!document || document.status === "draft") {
    notFound();
  }

  return (
    <>
      <PrintableDocument
        data={printableFromDocument(
          document,
          (key) => `/api/v1/logos?key=${encodeURIComponent(key)}`,
        )}
      />
      <AutoPrint />
    </>
  );
}

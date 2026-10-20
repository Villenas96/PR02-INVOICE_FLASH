import { DocumentDetail } from "@/components/documents/document-detail";

export default async function DocumentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const notice =
    query.upgraded === "1"
      ? "Tu plan se ha activado y el documento se ha emitido."
      : query.upgrade_pending === "1"
        ? "Hemos recibido tu pago. En cuanto se confirme podrás emitir este borrador; sigue guardado sin número."
        : null;

  return (
    <div className="space-y-4">
      {notice ? (
        <output className="block rounded-lg border bg-card p-4 text-sm shadow-sm">
          {notice}
        </output>
      ) : null}
      <DocumentDetail documentId={id} />
    </div>
  );
}

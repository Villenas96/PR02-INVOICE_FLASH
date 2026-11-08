import { DocumentDetail } from "@/components/documents/document-detail";
import { duplicateWarningTexts } from "@/lib/documents/duplicate-warnings";

export default async function DocumentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const seriesCreated =
    typeof query.series_created === "string" ? query.series_created : null;
  const notice = seriesCreated
    ? query.renamed === "1"
      ? `Hemos creado la serie ${seriesCreated} para este tipo de documento (ya existía una serie con el prefijo habitual).`
      : `Hemos creado la serie ${seriesCreated} para este tipo de documento.`
    : query.upgraded === "1"
      ? "Tu plan se ha activado y el documento se ha emitido."
      : query.upgrade_pending === "1"
        ? "Hemos recibido tu pago. En cuanto se confirme podrás emitir este borrador; sigue guardado sin número."
        : null;

  const warnings = duplicateWarningTexts(query.warnings);

  return (
    <div className="space-y-4">
      {warnings.length > 0 ? (
        <aside
          aria-label="Avisos del duplicado"
          className="space-y-1 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
        >
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </aside>
      ) : null}
      {notice ? (
        <output className="block rounded-lg border bg-card p-4 text-sm shadow-sm">
          {notice}
        </output>
      ) : null}
      <DocumentDetail documentId={id} />
    </div>
  );
}

import { InvoiceEditor } from "@/components/documents/editor/invoice-editor";
import { duplicateWarningTexts } from "@/lib/documents/duplicate-warnings";

export default async function EditDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const warnings = duplicateWarningTexts(query.warnings);
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">Borrador</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Editar borrador
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Los cambios no consumen numeración ni cuentan para el límite mensual.
        </p>
      </div>
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
      <InvoiceEditor documentId={id} />
    </div>
  );
}

import { InvoiceEditor } from "@/components/documents/editor/invoice-editor";

export default async function EditDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
      <InvoiceEditor documentId={id} />
    </div>
  );
}

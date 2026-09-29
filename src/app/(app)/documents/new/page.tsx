import { InvoiceEditor } from "@/components/documents/editor/invoice-editor";

export default function NewDocumentPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">
          Nueva factura
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Prepara tu factura
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          El borrador no consume numeración ni cuenta para el límite mensual.
        </p>
      </div>
      <InvoiceEditor />
    </div>
  );
}

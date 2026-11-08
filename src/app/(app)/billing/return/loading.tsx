export default function BillingReturnLoading() {
  return (
    <output className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border bg-card p-8 text-center shadow-sm">
      <span
        aria-hidden="true"
        className="size-8 animate-spin rounded-full border-4 border-muted border-t-primary"
      />
      <span className="font-medium">Activando tu plan…</span>
      <span className="text-sm text-muted-foreground">
        Estamos confirmando el pago y, si tenías una factura pendiente, la
        emitimos ahora.
      </span>
    </output>
  );
}

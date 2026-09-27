import { ClientList } from "@/components/clients/client-list";

export default function ClientsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Clientes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Busca, crea y archiva clientes sin afectar a los documentos ya
          emitidos.
        </p>
      </div>
      <ClientList />
    </div>
  );
}

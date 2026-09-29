import { CatalogList } from "@/components/catalog/catalog-list";

export default function CatalogPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Catálogo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Guarda servicios y conceptos habituales para añadirlos rápido a tus
          documentos.
        </p>
      </div>
      <CatalogList />
    </div>
  );
}

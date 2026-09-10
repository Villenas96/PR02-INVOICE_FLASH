import { SettingsPanel } from "@/components/settings/settings-panel";

export default function SettingsPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">
          Configuración
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Tu negocio, listo para facturar
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Completa los datos que aparecerán en tus documentos y decide cómo
          deben numerarse y vencer tus facturas.
        </p>
      </div>

      <SettingsPanel />
    </div>
  );
}

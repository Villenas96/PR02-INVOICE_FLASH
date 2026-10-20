"use client";

import { LogoUpload } from "@/components/ui/logo-upload";

interface LogoSettingsProps {
  logoKey: string | null;
  onChange: (logoKey: string | null) => void;
}

export function LogoSettings({ logoKey, onChange }: LogoSettingsProps) {
  return (
    <section
      className="rounded-xl border bg-card p-5 shadow-sm sm:p-6"
      aria-labelledby="logo-title"
    >
      <div className="mb-6 space-y-1">
        <h2 id="logo-title" className="text-lg font-semibold">
          Logotipo
        </h2>
        <p className="text-sm text-muted-foreground">
          PNG, JPEG o SVG de hasta 2 MiB. Se guarda de forma privada y aparece
          en la cabecera de tus documentos.
        </p>
      </div>
      <LogoUpload
        endpoint="/api/v1/company/logo"
        inputId="company-logo"
        logoKey={logoKey}
        onChange={onChange}
      />
    </section>
  );
}

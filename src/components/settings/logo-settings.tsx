"use client";

import { useRef } from "react";

import { useAsyncAction } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/api/client";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

interface LogoSettingsProps {
  logoKey: string | null;
  onChange: (logoKey: string | null) => void;
}

interface LogoResponse {
  logo_key: string;
}

export function LogoSettings({ logoKey, onChange }: LogoSettingsProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useAsyncAction<LogoResponse>();
  const removal = useAsyncAction<null>();
  const isLoading = upload.isLoading || removal.isLoading;
  const error = upload.error ?? removal.error;
  const success = upload.status === "success" || removal.status === "success";

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) {
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      await upload.run(() =>
        Promise.reject(new Error("El logotipo no puede superar 2 MiB.")),
      );
      return;
    }

    const body = new FormData();
    body.set("logo", file);
    const result = await upload.run(() =>
      apiRequest<LogoResponse>("/api/v1/company/logo", {
        method: "PUT",
        body,
      }),
    );
    if (result) {
      onChange(result.logo_key);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  async function handleRemove() {
    const result = await removal.run(() =>
      apiRequest<void>("/api/v1/company/logo", {
        method: "DELETE",
      }).then(() => null),
    );
    if (result === null) {
      onChange(null);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

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
          PNG, JPEG o SVG seguro de hasta 2 MiB. Se guarda de forma privada y se
          incorpora a los PDF.
        </p>
      </div>

      <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label htmlFor="company-logo">Seleccionar archivo</Label>
          <Input
            ref={inputRef}
            id="company-logo"
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            disabled={isLoading}
          />
          <p className="text-xs text-muted-foreground">
            {logoKey
              ? "Hay un logotipo configurado."
              : "Todavía no has añadido un logotipo."}
          </p>
        </div>
        <form className="flex flex-wrap gap-2" onSubmit={handleUpload}>
          <Button type="submit" disabled={isLoading}>
            {upload.isLoading ? "Subiendo…" : "Subir logotipo"}
          </Button>
          {logoKey ? (
            <Button
              type="button"
              variant="outline"
              disabled={isLoading}
              onClick={handleRemove}
            >
              {removal.isLoading ? "Eliminando…" : "Eliminar"}
            </Button>
          ) : null}
        </form>
      </div>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      ) : success ? (
        <output className="mt-4 block text-sm" aria-live="polite">
          Logotipo actualizado.
        </output>
      ) : null}
    </section>
  );
}

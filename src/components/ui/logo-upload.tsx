"use client";

import { useRef } from "react";

import { useMutation } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/api/client";
import { fitWithin, logoFileError, logoFileKind } from "@/lib/logo-file";

interface LogoResponse {
  logo_key: string;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("unreadable"));
    image.src = url;
  });
}

/**
 * pdf-lib cannot embed SVG, so the browser draws it on a canvas and uploads
 * the PNG. Rendering through `<img>` never runs scripts inside the SVG.
 */
async function rasterizeSvg(file: File): Promise<File> {
  const url = URL.createObjectURL(
    new Blob([await file.text()], { type: "image/svg+xml" }),
  );
  try {
    const image = await loadImage(url);
    const size = fitWithin(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("no-canvas");
    }
    context.drawImage(image, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) {
      throw new Error("no-blob");
    }
    return new File([blob], `${file.name.replace(/\.svg$/i, "")}.png`, {
      type: "image/png",
    });
  } catch {
    throw new Error(
      "No hemos podido convertir el SVG. Prueba con un PNG o JPEG.",
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function prepareLogoFile(file: File): Promise<File> {
  const error = logoFileError(file);
  if (error) {
    throw new Error(error);
  }
  return logoFileKind(file) === "svg" ? rasterizeSvg(file) : file;
}

interface LogoUploadProps {
  /** `PUT` uploads and `DELETE` removes, e.g. `/api/v1/company/logo`. */
  endpoint: string;
  inputId: string;
  logoKey: string | null;
  onChange: (logoKey: string | null) => void;
}

/**
 * Logo picker shared by the company settings and the client detail: PNG,
 * JPEG or SVG (rasterized here) up to 2 MiB, with a preview of the current
 * logo.
 */
export function LogoUpload({
  endpoint,
  inputId,
  logoKey,
  onChange,
}: LogoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useMutation<LogoResponse>();
  const removal = useMutation<null>();
  const isLoading = upload.isLoading || removal.isLoading;
  const error = upload.error ?? removal.error;
  const success = upload.status === "success" || removal.status === "success";

  function resetInput() {
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) {
      return;
    }
    const result = await upload.run(async () => {
      const body = new FormData();
      body.set("logo", await prepareLogoFile(file));
      return apiRequest<LogoResponse>(endpoint, { method: "PUT", body });
    });
    if (result) {
      onChange(result.logo_key);
      resetInput();
    }
  }

  async function handleRemove() {
    const result = await removal.run(() =>
      apiRequest<void>(endpoint, { method: "DELETE" }).then(() => null),
    );
    if (result === null) {
      onChange(null);
      resetInput();
    }
  }

  return (
    <div className="space-y-4">
      {logoKey ? (
        // biome-ignore lint/performance/noImgElement: private R2 logo served by an authenticated route; next/image would proxy it publicly.
        <img
          src={`/api/v1/logos?key=${encodeURIComponent(logoKey)}`}
          alt="Logotipo actual"
          className="max-h-16 max-w-40 rounded border bg-white object-contain p-1"
        />
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label htmlFor={inputId}>Seleccionar archivo</Label>
          <Input
            ref={inputRef}
            id={inputId}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,.svg"
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
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : success ? (
        <output className="block text-sm" aria-live="polite">
          Logotipo actualizado.
        </output>
      ) : null}
    </div>
  );
}

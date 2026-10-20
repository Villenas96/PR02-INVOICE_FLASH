"use client";

import type { ExportItem } from "./types";

const expiryFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "long",
  timeZone: "Europe/Madrid",
});

/** Outcome of the export being tracked, announced politely. */
export function ExportResult({
  job,
  isWaiting,
}: {
  job: ExportItem | null;
  isWaiting: boolean;
}) {
  if (!job && !isWaiting) {
    return null;
  }
  return (
    <output aria-live="polite" className="block text-sm">
      {!job || job.status === "queued" || job.status === "running" ? (
        "Preparando la exportación… Te avisaremos también en la campana."
      ) : job.status === "empty" ? (
        <span>
          No hay documentos en este periodo. Elige otro periodo o revisa los
          filtros.
        </span>
      ) : job.status === "failed" ? (
        <span className="text-destructive">
          No se ha podido preparar la exportación. Inténtalo de nuevo.
        </span>
      ) : (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {job.send_to_advisor ? <span>Enviada a tu asesoría.</span> : null}
          {job.files.map((file) => (
            <a
              key={file.url}
              href={file.url}
              className="font-medium underline underline-offset-4"
            >
              Descargar {file.filename}
            </a>
          ))}
          {job.expires_at ? (
            <span className="text-muted-foreground">
              Enlace válido hasta el{" "}
              {expiryFormatter.format(new Date(job.expires_at))}.
            </span>
          ) : null}
        </span>
      )}
    </output>
  );
}

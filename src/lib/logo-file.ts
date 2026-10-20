/**
 * Browser-side checks for logo uploads (specs/002 research R10). The server
 * only stores PNG/JPEG, so SVG files are rasterized before upload at twice
 * the largest box a logo is drawn in (the PDF header, 150 × 48 pt).
 */

export const MAX_LOGO_UPLOAD_BYTES = 2 * 1024 * 1024;
export const RASTER_BOX = { width: 300, height: 96 } as const;
const FALLBACK_SVG_SIZE = 512;

export type LogoFileKind = "raster" | "svg" | "unsupported";

export function logoFileKind(file: {
  type: string;
  name: string;
}): LogoFileKind {
  const type = file.type.toLowerCase();
  if (type === "image/png" || type === "image/jpeg") {
    return "raster";
  }
  if (type === "image/svg+xml" || /\.svg$/i.test(file.name)) {
    return "svg";
  }
  return "unsupported";
}

/** Largest size that fits the box keeping the aspect ratio (never 0). */
export function fitWithin(
  width: number,
  height: number,
  box: { width: number; height: number } = RASTER_BOX,
): { width: number; height: number } {
  const safeWidth = width > 0 ? width : FALLBACK_SVG_SIZE;
  const safeHeight = height > 0 ? height : FALLBACK_SVG_SIZE;
  const scale = Math.min(box.width / safeWidth, box.height / safeHeight);
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

export function logoFileError(file: {
  type: string;
  name: string;
  size: number;
}): string | null {
  if (logoFileKind(file) === "unsupported") {
    return "Formato no admitido. Usa un archivo PNG, JPEG o SVG.";
  }
  if (file.size > MAX_LOGO_UPLOAD_BYTES) {
    return "El logotipo no puede superar 2 MiB.";
  }
  return null;
}

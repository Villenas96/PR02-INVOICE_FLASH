import { ApiError } from "@/lib/api/errors";
import type { PrivateBucket } from "@/services/storage";

/**
 * Logos for companies and clients (specs/002 research R10): PNG or JPEG
 * only (pdf-lib cannot embed SVG; the browser rasterizes SVG before
 * upload), at most 2 MiB and 4.000 px per side, stored under a
 * content-addressed key `logos/{company_id}/{sha256}.{png|jpg}` that is
 * never overwritten, so frozen snapshots keep pointing at the exact image.
 */

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const MAX_LOGO_DIMENSION = 4_000;
const MAX_MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
const EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg" } as const;
type LogoContentType = keyof typeof EXTENSIONS;

export interface ValidatedLogo {
  bytes: Uint8Array;
  contentType: LogoContentType;
  extension: "png" | "jpg";
  width: number;
  height: number;
}

function logoError(message: string, status = 400): ApiError {
  return new ApiError("validation_error", status, message, { logo: message });
}

export function assertLogoRequestSize(request: Request): void {
  const contentLength = Number(request.headers.get("content-length") ?? "");
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_LOGO_BYTES + MAX_MULTIPART_OVERHEAD_BYTES
  ) {
    throw logoError("El logotipo no puede superar 2 MiB.", 413);
  }
}

export async function logoFileFrom(request: Request): Promise<File> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw logoError("Envía el logotipo como formulario multipart válido.");
  }
  const logos = formData.getAll("logo");
  if (logos.length !== 1 || !(logos[0] instanceof File)) {
    throw logoError("Adjunta un único archivo en el campo «logo».");
  }
  return logos[0];
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

function chunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
}

function isStructurallyValidPng(bytes: Uint8Array): boolean {
  if (
    bytes.length < 45 ||
    !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
  ) {
    return false;
  }

  let position: number = PNG_SIGNATURE.length;
  let chunkIndex = 0;
  let hasImageData = false;

  while (position + 12 <= bytes.length) {
    const dataLength = readUint32(bytes, position);
    const type = chunkType(bytes, position + 4);
    const chunkEnd = position + 12 + dataLength;

    if (
      !/^[A-Za-z]{4}$/.test(type) ||
      dataLength > MAX_LOGO_BYTES ||
      chunkEnd > bytes.length
    ) {
      return false;
    }

    if (chunkIndex === 0) {
      if (
        type !== "IHDR" ||
        dataLength !== 13 ||
        readUint32(bytes, position + 8) === 0 ||
        readUint32(bytes, position + 12) === 0
      ) {
        return false;
      }

      const compressionMethod = bytes[position + 18];
      const filterMethod = bytes[position + 19];
      const interlaceMethod = bytes[position + 20];
      const bitDepth = bytes[position + 16];
      const colorType = bytes[position + 17];
      const validBitDepth =
        (colorType === 0 && [1, 2, 4, 8, 16].includes(bitDepth)) ||
        (colorType === 2 && [8, 16].includes(bitDepth)) ||
        (colorType === 3 && [1, 2, 4, 8].includes(bitDepth)) ||
        ((colorType === 4 || colorType === 6) && [8, 16].includes(bitDepth));
      if (
        !validBitDepth ||
        compressionMethod !== 0 ||
        filterMethod !== 0 ||
        (interlaceMethod !== 0 && interlaceMethod !== 1)
      ) {
        return false;
      }
    }

    if (type === "IHDR" && chunkIndex !== 0) {
      return false;
    }
    if (type === "IDAT" && dataLength > 0) {
      hasImageData = true;
    }
    if (type === "IEND") {
      return dataLength === 0 && hasImageData && chunkEnd === bytes.length;
    }

    position = chunkEnd;
    chunkIndex += 1;
  }

  return false;
}

function isStructurallyValidJpeg(bytes: Uint8Array): boolean {
  if (
    bytes.length < 16 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9
  ) {
    return false;
  }

  let position = 2;
  let hasStartOfFrame = false;

  while (position < bytes.length - 2) {
    if (bytes[position] !== 0xff) {
      return false;
    }
    while (bytes[position] === 0xff) {
      position += 1;
    }

    const marker = bytes[position];
    position += 1;

    if (marker === 0xda) {
      return hasStartOfFrame;
    }
    if (
      marker === 0x00 ||
      marker === 0xd8 ||
      marker === 0xd9 ||
      position + 2 > bytes.length
    ) {
      return false;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    const segmentLength = bytes[position] * 256 + bytes[position + 1];
    if (segmentLength < 2 || position + segmentLength > bytes.length) {
      return false;
    }

    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 8) {
        return false;
      }
      const height = bytes[position + 3] * 256 + bytes[position + 4];
      const width = bytes[position + 5] * 256 + bytes[position + 6];
      if (width === 0 || height === 0) {
        return false;
      }
      hasStartOfFrame = true;
    }

    position += segmentLength;
  }

  return false;
}

/** Width and height from the PNG IHDR or the JPEG start-of-frame. */
export function imageDimensions(
  contentType: string,
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (contentType === "image/png" && bytes.length >= 24) {
    return { width: readUint32(bytes, 16), height: readUint32(bytes, 20) };
  }
  if (contentType === "image/jpeg") {
    let position = 2;
    while (position + 9 < bytes.length) {
      if (bytes[position] !== 0xff) {
        return null;
      }
      while (bytes[position] === 0xff) {
        position += 1;
      }
      const marker = bytes[position] ?? 0;
      position += 1;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        continue;
      }
      const length = (bytes[position] ?? 0) * 256 + (bytes[position + 1] ?? 0);
      if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
        return {
          height: (bytes[position + 3] ?? 0) * 256 + (bytes[position + 4] ?? 0),
          width: (bytes[position + 5] ?? 0) * 256 + (bytes[position + 6] ?? 0),
        };
      }
      position += length;
    }
  }
  return null;
}

export async function validateLogoFile(file: File): Promise<ValidatedLogo> {
  if (file.type === "image/svg+xml") {
    throw logoError(
      "Sube el logotipo en PNG o JPEG. Los SVG se convierten automáticamente al subirlos desde Ajustes.",
    );
  }
  if (!(file.type in EXTENSIONS)) {
    throw logoError("El logotipo debe ser PNG o JPEG.");
  }
  if (file.size === 0) {
    throw logoError("El archivo del logotipo está vacío.");
  }
  if (file.size > MAX_LOGO_BYTES) {
    throw logoError("El logotipo no puede superar 2 MiB.", 413);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = file.type as LogoContentType;
  const valid =
    contentType === "image/png"
      ? isStructurallyValidPng(bytes)
      : isStructurallyValidJpeg(bytes);
  const dimensions = valid ? imageDimensions(contentType, bytes) : null;
  if (!dimensions) {
    throw logoError("El contenido del archivo no es un PNG o JPEG válido.");
  }
  if (
    dimensions.width > MAX_LOGO_DIMENSION ||
    dimensions.height > MAX_LOGO_DIMENSION
  ) {
    throw logoError("El logotipo no puede superar 4.000 píxeles por lado.");
  }
  return {
    bytes,
    contentType,
    extension: EXTENSIONS[contentType],
    ...dimensions,
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function logoKeyPrefix(companyId: string): string {
  return `logos/${companyId}/`;
}

/** Stores the logo under its content hash; re-uploading the same image is a
 * no-op that yields the same key. */
export async function storeLogo(
  bucket: PrivateBucket,
  companyId: string,
  logo: ValidatedLogo,
): Promise<string> {
  const key = `${logoKeyPrefix(companyId)}${await sha256Hex(logo.bytes)}.${logo.extension}`;
  await bucket.put(key, logo.bytes, {
    httpMetadata: { contentType: logo.contentType },
  });
  return key;
}

/** Keys a company may read: its content-addressed logos and v1 logos. */
export function isCompanyLogoKey(companyId: string, key: string): boolean {
  return (
    !key.includes("..") &&
    (key.startsWith(logoKeyPrefix(companyId)) ||
      key.startsWith(`companies/${companyId}/logos/`))
  );
}

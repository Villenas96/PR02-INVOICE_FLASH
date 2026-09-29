export interface R2ObjectBody {
  body: ReadableStream<Uint8Array>;
  httpMetadata?: { contentType?: string };
}

export interface PrivateBucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
}

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_CONTENT_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
} as const;

type LogoContentType = keyof typeof LOGO_CONTENT_TYPES;

export function pdfObjectKey(documentId: string): string {
  return `documents/${documentId}/pdf/v1.pdf`;
}

export function logoObjectKey(
  companyId: string,
  contentType: LogoContentType,
): string {
  return `companies/${companyId}/logos/${crypto.randomUUID()}.${LOGO_CONTENT_TYPES[contentType]}`;
}

export async function storeCompanyLogo(
  bucket: PrivateBucket,
  companyId: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string> {
  if (!(contentType in LOGO_CONTENT_TYPES)) {
    throw new Error("El logotipo debe ser PNG, JPG o SVG.");
  }

  if (bytes.byteLength > MAX_LOGO_BYTES) {
    throw new Error("El logotipo no puede superar 2 MB.");
  }

  const validContentType = contentType as LogoContentType;
  const key = logoObjectKey(companyId, validContentType);
  await bucket.put(key, bytes, {
    httpMetadata: { contentType: validContentType },
  });
  return key;
}

export async function getPrivateObject(
  bucket: PrivateBucket,
  key: string,
): Promise<R2ObjectBody | null> {
  return bucket.get(key);
}

export async function deletePrivateObject(
  bucket: PrivateBucket,
  key: string,
): Promise<void> {
  await bucket.delete(key);
}

export async function storeDocumentPdf(
  bucket: PrivateBucket,
  documentId: string,
  bytes: Uint8Array,
): Promise<string> {
  const key = pdfObjectKey(documentId);
  await bucket.put(key, bytes, {
    httpMetadata: { contentType: "application/pdf" },
  });
  return key;
}

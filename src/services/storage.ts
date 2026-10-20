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

export function pdfObjectKey(documentId: string): string {
  return `documents/${documentId}/pdf/v1.pdf`;
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

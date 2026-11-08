import type {
  MultipartUpload,
  PrivateBucket,
  R2ObjectBody,
} from "@/services/storage";

/** In-memory stand-in for the private R2 bucket binding. */
export class InMemoryBucket implements PrivateBucket {
  readonly objects = new Map<
    string,
    { bytes: Uint8Array; contentType?: string }
  >();

  get(key: string): Promise<R2ObjectBody | null> {
    const value = this.objects.get(key);
    if (!value) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      body: new Blob([value.bytes.slice().buffer as ArrayBuffer]).stream(),
      httpMetadata: { contentType: value.contentType },
    });
  }

  put(
    key: string,
    value: Uint8Array | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<void> {
    const bytes =
      typeof value === "string" ? new TextEncoder().encode(value) : value;
    this.objects.set(key, {
      bytes: bytes.slice(),
      contentType: options?.httpMetadata?.contentType,
    });
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  /** Sizes of the parts of each completed multipart upload, by key. */
  readonly multipartParts = new Map<string, number[]>();

  createMultipartUpload(
    key: string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<MultipartUpload> {
    const parts = new Map<number, Uint8Array>();
    return Promise.resolve({
      uploadPart: (partNumber: number, value: Uint8Array) => {
        parts.set(partNumber, value.slice());
        return Promise.resolve({ partNumber, etag: `etag-${partNumber}` });
      },
      complete: async (
        uploaded: Array<{ partNumber: number; etag: string }>,
      ) => {
        const ordered = uploaded.map((part) => {
          const bytes = parts.get(part.partNumber);
          if (!bytes || part.etag !== `etag-${part.partNumber}`) {
            throw new Error("Parte de subida desconocida.");
          }
          return bytes;
        });
        const total = ordered.reduce((sum, part) => sum + part.byteLength, 0);
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const part of ordered) {
          bytes.set(part, offset);
          offset += part.byteLength;
        }
        this.multipartParts.set(
          key,
          ordered.map((part) => part.byteLength),
        );
        await this.put(key, bytes, options);
      },
      abort: () => Promise.resolve(),
    });
  }
}

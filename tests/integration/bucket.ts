import type { PrivateBucket, R2ObjectBody } from "@/services/storage";

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
}

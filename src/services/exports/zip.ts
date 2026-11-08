import { Zip, ZipPassThrough } from "fflate";

import type { MultipartUpload, PrivateBucket } from "@/services/storage";

/** R2 multipart parts must be at least 5 MiB (except the last one). */
export const MULTIPART_PART_BYTES = 5 * 1024 * 1024;

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

/**
 * Collects output chunks into ≥ 5 MiB parts and uploads each as soon as it
 * fills, so the whole archive is never held in memory (research R12).
 * Buckets without multipart support get a single `put` instead.
 */
class PartWriter {
  private buffered: Uint8Array[] = [];
  private bufferedBytes = 0;
  private readonly parts: Array<{ partNumber: number; etag: string }> = [];
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly upload: MultipartUpload | null,
    private readonly bucket: PrivateBucket,
    private readonly key: string,
    private readonly contentType: string,
  ) {}

  write(chunk: Uint8Array): void {
    this.buffered.push(chunk);
    this.bufferedBytes += chunk.byteLength;
    if (this.upload && this.bufferedBytes >= MULTIPART_PART_BYTES) {
      this.flushPart();
    }
  }

  private take(): Uint8Array {
    const part = new Uint8Array(this.bufferedBytes);
    let offset = 0;
    for (const chunk of this.buffered) {
      part.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.buffered = [];
    this.bufferedBytes = 0;
    return part;
  }

  private flushPart(): void {
    const upload = this.upload;
    if (!upload) {
      return;
    }
    const bytes = this.take();
    const partNumber = this.parts.length + 1;
    this.parts.push({ partNumber, etag: "" });
    this.pending = this.pending.then(async () => {
      const uploaded = await upload.uploadPart(partNumber, bytes);
      this.parts[partNumber - 1] = uploaded;
    });
  }

  /** Waits for uploads in flight (keeps memory bounded between entries). */
  drain(): Promise<void> {
    return this.pending;
  }

  async finish(): Promise<number> {
    if (!this.upload) {
      const bytes = this.take();
      await this.bucket.put(this.key, bytes, {
        httpMetadata: { contentType: this.contentType },
      });
      return bytes.byteLength;
    }
    if (this.bufferedBytes > 0 || this.parts.length === 0) {
      this.flushPart();
    }
    await this.pending;
    await this.upload.complete(this.parts);
    return this.parts.length;
  }

  async abort(): Promise<void> {
    await this.pending.catch(() => undefined);
    await this.upload?.abort();
  }
}

/**
 * Streams PDFs into a ZIP stored without recompression (PDFs are already
 * compressed; level 0 saves CPU) and uploads it to R2.
 */
export async function writePdfZip(input: {
  bucket: PrivateBucket;
  key: string;
  entries: AsyncIterable<ZipEntry>;
}): Promise<void> {
  const contentType = "application/zip";
  const upload = input.bucket.createMultipartUpload
    ? await input.bucket.createMultipartUpload(input.key, {
        httpMetadata: { contentType },
      })
    : null;
  const writer = new PartWriter(upload, input.bucket, input.key, contentType);
  let failure: Error | null = null;
  const done = new Promise<void>((resolve) => {
    const zip = new Zip((error, chunk, final) => {
      if (error) {
        failure = error;
        resolve();
        return;
      }
      writer.write(chunk);
      if (final) {
        resolve();
      }
    });
    void (async () => {
      try {
        for await (const entry of input.entries) {
          const file = new ZipPassThrough(entry.name);
          zip.add(file);
          file.push(entry.bytes, true);
          await writer.drain();
        }
        zip.end();
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
        zip.terminate();
        resolve();
      }
    })();
  });
  await done;
  if (failure) {
    await writer.abort();
    throw failure;
  }
  await writer.finish();
}

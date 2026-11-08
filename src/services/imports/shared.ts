import { eq } from "drizzle-orm";
import type { Database } from "@/db";
import { importJobs } from "@/db/schema/import-job";
import { ApiError } from "@/lib/api/errors";
import type { PrivateBucket } from "@/services/storage";

export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

export interface JobsQueue {
  send(message: unknown): Promise<void>;
}

export interface ImportJobDependencies {
  database?: Database;
  bucket: PrivateBucket;
  now?: Date;
}

export function importObjectKey(
  companyId: string,
  importId: string,
  extension = "csv",
): string {
  return `imports/${companyId}/${importId}.${extension}`;
}

export async function readImportFile(
  bucket: PrivateBucket,
  key: string,
): Promise<Uint8Array | null> {
  const object = await bucket.get(key);
  if (!object) {
    return null;
  }
  return new Uint8Array(await new Response(object.body).arrayBuffer());
}

export async function finishWith(
  database: Database,
  importId: string,
  values: Partial<typeof importJobs.$inferInsert>,
  now: Date,
): Promise<void> {
  await database
    .update(importJobs)
    .set({ ...values, updatedAt: now })
    .where(eq(importJobs.id, importId));
}

export function importTooLargeError(): ApiError {
  return new ApiError(
    "import_too_large",
    400,
    `El archivo supera el límite de 5 MB o 5.000 filas. Divídelo en varios archivos.`,
  );
}

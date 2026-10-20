import { z } from "zod";

/** One file of an export job (`export_job.file_keys`), stored in R2. */
export const exportFileSchema = z
  .object({
    key: z.string().regex(/^exports\/[0-9a-f-]{36}\/[^/]+$/),
    filename: z.string().min(1).max(200),
    content_type: z.string().min(1),
  })
  .strict();
export const exportFilesSchema = z.array(exportFileSchema);
export type ExportFile = z.infer<typeof exportFileSchema>;

export function exportObjectKey(companyId: string, name: string): string {
  return `exports/${companyId}/${name}`;
}

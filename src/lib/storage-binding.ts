import { getCloudflareContext } from "@opennextjs/cloudflare";

import type { PrivateBucket } from "@/services/storage";

/** The private R2 bucket binding inside a route handler. */
export async function getPrivateBucket(): Promise<PrivateBucket> {
  const { env } = await getCloudflareContext({ async: true });
  const bucket = (env as unknown as { STORAGE_BUCKET?: PrivateBucket })
    .STORAGE_BUCKET;
  if (!bucket) {
    throw new Error("STORAGE_BUCKET no está configurado.");
  }
  return bucket;
}

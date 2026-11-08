import { getCloudflareContext } from "@opennextjs/cloudflare";

import { ApiError } from "@/lib/api/errors";

export interface QueueBinding {
  send(message: unknown): Promise<void>;
}

export type QueueName = "PDF_RENDER_QUEUE" | "EMAIL_SEND_QUEUE" | "JOBS_QUEUE";

/**
 * Resolves a queue producer binding inside a route handler. A missing
 * binding is a deployment error: callers get a generic 500, never a leak of
 * configuration details.
 */
export async function getQueue(name: QueueName): Promise<QueueBinding> {
  const { env } = await getCloudflareContext({ async: true });
  const queue = (env as unknown as Record<string, QueueBinding | undefined>)[
    name
  ];
  if (!queue) {
    throw new ApiError(
      "internal_error",
      500,
      "No se ha podido iniciar el trabajo en segundo plano.",
    );
  }
  return queue;
}

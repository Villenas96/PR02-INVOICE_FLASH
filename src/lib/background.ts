import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Keeps a fire-and-forget task (e.g. a Sentry report) alive after the HTTP
 * response is sent. On Cloudflare Workers, work still pending when the
 * response returns may be cancelled unless it is registered with
 * `ctx.waitUntil`. Outside a Worker request (unit tests, `next dev` without a
 * Cloudflare context) there is nothing to extend and the task just runs.
 */
export function runInBackground(task: Promise<unknown>): void {
  const settled = task.catch(() => undefined);
  try {
    getCloudflareContext().ctx.waitUntil(settled);
  } catch {
    // No Cloudflare request context available.
  }
}

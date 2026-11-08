/**
 * Lazily creates an instance whose initialisation is asynchronous and shares
 * it across requests only after that initialisation has resolved.
 *
 * On Cloudflare Workers, I/O started during a request is cancelled when that
 * request ends. A module-level instance whose async init runs inside a short
 * request (e.g. an RSC prefetch that finishes first) keeps a promise that
 * never settles, and every later request in the isolate that awaits it hangs.
 * Here each caller awaits its own instance's init inside its own request; a
 * pending or failed instance is never handed to another request.
 */
export function requestSafeSingleton<T>(
  create: () => T,
  ready: (instance: T) => Promise<unknown>,
): () => Promise<T> {
  let shared: T | undefined;

  return async () => {
    if (shared !== undefined) {
      return shared;
    }

    const instance = create();
    await ready(instance);
    shared ??= instance;
    return shared;
  };
}

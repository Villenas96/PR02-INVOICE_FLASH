import { logSafe, redactForLogs, type SafeLogContext } from "@/lib/log";

interface SentryDsn {
  host: string;
  projectId: string;
  publicKey: string;
  protocol: string;
}

function parseSentryDsn(dsn: string | undefined): SentryDsn | undefined {
  if (!dsn) {
    return undefined;
  }

  try {
    const url = new URL(dsn);
    const projectId = url.pathname.split("/").filter(Boolean).at(-1);

    if (!projectId || !url.username) {
      return undefined;
    }

    return {
      host: url.host,
      projectId,
      publicKey: url.username,
      protocol: url.protocol,
    };
  } catch {
    return undefined;
  }
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

/**
 * Sends a minimal, already-redacted error event to Sentry without including an
 * exception message, request body, fiscal data or authentication credentials.
 * Resolves to the event id when Sentry accepted the event, so operators can
 * locate it (e.g. the pre-deploy test event); callers may ignore it.
 */
export async function captureException(
  error: unknown,
  context: SafeLogContext = {},
): Promise<string | undefined> {
  const dsn = parseSentryDsn(process.env.SENTRY_DSN);
  const safeContext = redactForLogs(context) as SafeLogContext;

  if (!dsn) {
    logSafe("warn", "sentry.not_configured", {
      error_type: errorType(error),
      ...safeContext,
    });
    return undefined;
  }

  const endpoint = `${dsn.protocol}//${dsn.host}/api/${dsn.projectId}/store/?sentry_version=7&sentry_key=${dsn.publicKey}`;
  const payload = {
    event_id: crypto.randomUUID().replaceAll("-", ""),
    platform: "javascript",
    level: "error",
    timestamp: Math.floor(Date.now() / 1000),
    exception: { values: [{ type: errorType(error) }] },
    tags: { request_id: safeContext.request_id },
    extra: safeContext,
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      logSafe("warn", "sentry.delivery_failed", {
        request_id: safeContext.request_id,
        status: response.status,
      });
      return undefined;
    }
    return payload.event_id;
  } catch {
    logSafe("warn", "sentry.delivery_failed", {
      request_id: safeContext.request_id,
      status: "network_error",
    });
    return undefined;
  }
}

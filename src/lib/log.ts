const SENSITIVE_KEY_PATTERN =
  /(?:address|amount|email|iban|message|nif|notes|recipient|tax|token|url)/i;

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const NIF_PATTERN =
  /\b(?:[0-9]{8}[A-Z]|[XYZ][0-9]{7}[A-Z]|[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J])\b/gi;
const TOKEN_PATTERN = /\b(?:bearer\s+)?[A-Za-z0-9_-]{24,}\b/gi;

export type SafeLogContext = Record<string, unknown>;

function redactString(value: string): string {
  return value
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(NIF_PATTERN, "[redacted-tax-id]")
    .replace(TOKEN_PATTERN, "[redacted-token]");
}

export function redactForLogs(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY_PATTERN.test(key)) {
    return "[redacted]";
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactForLogs(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactForLogs(entryValue, entryKey),
      ]),
    );
  }

  return value;
}

/** Emits structured logs without fiscal, financial or authentication data. */
export function logSafe(
  level: "error" | "info" | "warn",
  event: string,
  context: SafeLogContext = {},
): void {
  const safeContext = redactForLogs(context) as SafeLogContext;
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...safeContext,
  });

  if (level === "error") {
    console.error(entry);
    return;
  }

  if (level === "warn") {
    console.warn(entry);
    return;
  }

  console.info(entry);
}

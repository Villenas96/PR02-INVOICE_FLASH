/**
 * Post-login destination from `?next=`: only same-origin relative paths
 * (e.g. an advisor invitation link). Browsers read `/\host` as `//host`, so
 * backslashes and control characters are rejected and the resolved URL must
 * keep the current origin.
 */
export function safeNextPath(
  value: string | null,
  origin: string,
): string | null {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point.
    /[\\\u0000-\u001f]/.test(value)
  ) {
    return null;
  }
  try {
    const url = new URL(value, origin);
    return url.origin === origin
      ? `${url.pathname}${url.search}${url.hash}`
      : null;
  } catch {
    return null;
  }
}

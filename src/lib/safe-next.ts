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
    if (url.origin !== origin) {
      return null;
    }
    // Normalization can turn `/.//host` into `//host`: check the output too.
    const path = `${url.pathname}${url.search}${url.hash}`;
    return path.startsWith("/") &&
      !path.startsWith("//") &&
      !path.startsWith("/\\")
      ? path
      : null;
  } catch {
    return null;
  }
}

/**
 * Expiring download links for exports (research R12): `{random}.{tag}`
 * where `random` has 256 bits and `tag` is an HMAC-SHA256 of it. The tag
 * rejects forged or truncated tokens without touching the database; only
 * the SHA-256 of the whole token is stored (`export_job.download_token_hash`).
 */

export const DOWNLOAD_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const RANDOM_BYTES = 32;
const TAG_BYTES = 16;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{22}$/;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function tagFor(secret: string, random: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`download-token:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(random),
  );
  return base64Url(new Uint8Array(signature).slice(0, TAG_BYTES));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function hashDownloadToken(token: string): Promise<string> {
  return hex(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
  );
}

export async function createDownloadToken(
  secret: string,
  now = new Date(),
): Promise<{ token: string; hash: string; expiresAt: Date }> {
  const random = base64Url(
    crypto.getRandomValues(new Uint8Array(RANDOM_BYTES)),
  );
  const token = `${random}.${await tagFor(secret, random)}`;
  return {
    token,
    hash: await hashDownloadToken(token),
    expiresAt: new Date(now.getTime() + DOWNLOAD_TOKEN_TTL_MS),
  };
}

/** Shape and signature only; expiry and existence are checked in the DB. */
export async function isSignedDownloadToken(
  secret: string,
  token: string,
): Promise<boolean> {
  if (!TOKEN_PATTERN.test(token)) {
    return false;
  }
  const [random = "", tag = ""] = token.split(".");
  return constantTimeEqual(tag, await tagFor(secret, random));
}

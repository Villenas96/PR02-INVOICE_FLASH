export const SHARE_TOKEN_BYTES = 32;

/** Base64url alphabet, matching RFC 4648 §5 (no padding, `-`/`_` in place of `+`/`/`). */
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export function encodeShareToken(bytes: Uint8Array): string {
  if (bytes.length !== SHARE_TOKEN_BYTES) {
    throw new RangeError(
      `Un token de enlace debe tener exactamente ${SHARE_TOKEN_BYTES} bytes.`,
    );
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function isWellFormedShareToken(token: string): boolean {
  return BASE64URL_PATTERN.test(token) && token.length >= 40;
}

/** CSPRNG token: 32 bytes (≥128 bits) is not practically guessable (US5-AC2). */
export function createShareToken(): string {
  const bytes = new Uint8Array(SHARE_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return encodeShareToken(bytes);
}

export interface ExistingShareLink {
  id: string;
  disabledAt: Date | null;
}

export type ShareLinkCreationDecision =
  | { action: "create" }
  | { action: "reactivate"; id: string };

/**
 * A document has at most one share_link row for its lifetime (DB-enforced
 * one-active-link rule): creating "reactivates" the existing row — including
 * when it is already active, which is an idempotent no-op — instead of
 * minting a new token each cycle.
 */
export function decideShareLinkCreation(
  existing: ExistingShareLink | null,
): ShareLinkCreationDecision {
  if (!existing) {
    return { action: "create" };
  }
  return { action: "reactivate", id: existing.id };
}

export type ShareLinkDisableDecision =
  | { action: "disable"; id: string }
  | { action: "not_found" };

export function decideShareLinkDisable(
  existing: ExistingShareLink | null,
): ShareLinkDisableDecision {
  if (!existing) {
    return { action: "not_found" };
  }
  return { action: "disable", id: existing.id };
}

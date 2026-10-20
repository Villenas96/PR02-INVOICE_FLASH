import { describe, expect, it } from "vitest";

import {
  createDownloadToken,
  DOWNLOAD_TOKEN_TTL_MS,
  hashDownloadToken,
  isSignedDownloadToken,
} from "@/lib/download-tokens";

const SECRET = "download-secret-at-least-thirty-two-characters";
const NOW = new Date("2026-10-20T10:00:00.000Z");

describe("download tokens", () => {
  it("creates a signed 256-bit token that expires in 7 days", async () => {
    const { token, hash, expiresAt } = await createDownloadToken(SECRET, NOW);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{22}$/);
    expect(expiresAt.getTime() - NOW.getTime()).toBe(DOWNLOAD_TOKEN_TTL_MS);
    expect(hash).toBe(await hashDownloadToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(await isSignedDownloadToken(SECRET, token)).toBe(true);
  });

  it("never repeats tokens", async () => {
    const tokens = new Set(
      await Promise.all(
        Array.from(
          { length: 50 },
          async () => (await createDownloadToken(SECRET, NOW)).token,
        ),
      ),
    );
    expect(tokens.size).toBe(50);
  });

  it("rejects forged, tampered or malformed tokens", async () => {
    const { token } = await createDownloadToken(SECRET, NOW);
    const [random, tag] = token.split(".") as [string, string];
    const flipped = `${random.slice(0, -1)}${random.endsWith("A") ? "B" : "A"}.${tag}`;
    expect(await isSignedDownloadToken(SECRET, flipped)).toBe(false);
    expect(
      await isSignedDownloadToken("another-secret-of-enough-length!", token),
    ).toBe(false);
    expect(await isSignedDownloadToken(SECRET, random)).toBe(false);
    expect(await isSignedDownloadToken(SECRET, "../etc/passwd")).toBe(false);
    expect(await isSignedDownloadToken(SECRET, "")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import {
  createShareToken,
  decideShareLinkCreation,
  decideShareLinkDisable,
  encodeShareToken,
  isWellFormedShareToken,
  SHARE_TOKEN_BYTES,
} from "@/lib/share-links";

describe("share tokens", () => {
  it("encodes exactly 32 bytes as an unpadded base64url string", () => {
    const bytes = new Uint8Array(SHARE_TOKEN_BYTES).fill(0);
    const token = encodeShareToken(bytes);
    expect(token).not.toContain("=");
    expect(token).not.toContain("+");
    expect(token).not.toContain("/");
    expect(isWellFormedShareToken(token)).toBe(true);
  });

  it("rejects a byte length other than 32", () => {
    expect(() => encodeShareToken(new Uint8Array(16))).toThrow();
    expect(() => encodeShareToken(new Uint8Array(33))).toThrow();
  });

  it("creates well-formed, non-guessable, unique tokens", () => {
    const tokens = Array.from({ length: 50 }, () => createShareToken());
    for (const token of tokens) {
      expect(isWellFormedShareToken(token)).toBe(true);
    }
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("rejects a token that is too short or contains invalid characters", () => {
    expect(isWellFormedShareToken("short")).toBe(false);
    expect(isWellFormedShareToken(`${"a".repeat(40)}+`)).toBe(false);
  });
});

describe("one-active-link rules", () => {
  it("creates a brand new link when none exists yet", () => {
    expect(decideShareLinkCreation(null)).toEqual({ action: "create" });
  });

  it("reactivates the existing link when one already exists, active or not", () => {
    expect(decideShareLinkCreation({ id: "link-1", disabledAt: null })).toEqual(
      { action: "reactivate", id: "link-1" },
    );
    expect(
      decideShareLinkCreation({ id: "link-1", disabledAt: new Date() }),
    ).toEqual({ action: "reactivate", id: "link-1" });
  });
});

describe("disable transitions", () => {
  it("disables an existing link regardless of its current state", () => {
    expect(decideShareLinkDisable({ id: "link-1", disabledAt: null })).toEqual({
      action: "disable",
      id: "link-1",
    });
    expect(
      decideShareLinkDisable({ id: "link-1", disabledAt: new Date() }),
    ).toEqual({ action: "disable", id: "link-1" });
  });

  it("reports not_found when there is nothing to disable", () => {
    expect(decideShareLinkDisable(null)).toEqual({ action: "not_found" });
  });
});

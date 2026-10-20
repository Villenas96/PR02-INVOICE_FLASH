import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/safe-next";

const ORIGIN = "https://factum.example";

describe("safeNextPath", () => {
  it("keeps same-origin relative paths", () => {
    expect(safeNextPath("/advisor/accept?token=a.b", ORIGIN)).toBe(
      "/advisor/accept?token=a.b",
    );
    expect(safeNextPath("/documents#top", ORIGIN)).toBe("/documents#top");
  });

  it.each([
    null,
    "",
    "documents",
    "//evil.example/path",
    "/\\evil.example",
    "/\\/evil.example",
    "/\tevil",
    "https://evil.example/",
    "javascript:alert(1)",
  ])("rejects %j", (value) => {
    expect(safeNextPath(value, ORIGIN)).toBeNull();
  });

  it("keeps encoded characters inside the same origin", () => {
    const result = safeNextPath("/%2F%2Fevil.example", ORIGIN);
    expect(new URL(result ?? "", ORIGIN).origin).toBe(ORIGIN);
  });
});

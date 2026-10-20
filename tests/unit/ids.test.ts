import { describe, expect, it } from "vitest";

import { createUuidV7, deterministicUuid } from "@/lib/ids";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("ids", () => {
  it("creates time-ordered UUIDv7", () => {
    const first = createUuidV7(1_000);
    const second = createUuidV7(2_000);
    expect(first).toMatch(UUID);
    expect(first[14]).toBe("7");
    expect(first < second).toBe(true);
  });

  it("derives the same UUIDv8 for the same parts and a different one otherwise", async () => {
    const id = await deterministicUuid("company", "source", "invoice", "key-1");
    expect(id).toMatch(UUID);
    expect(id[14]).toBe("8");
    expect(
      await deterministicUuid("company", "source", "invoice", "key-1"),
    ).toBe(id);
    expect(
      await deterministicUuid("company", "source", "invoice", "key-2"),
    ).not.toBe(id);
    // Parts are separated: ("ab","c") ≠ ("a","bc").
    expect(await deterministicUuid("ab", "c")).not.toBe(
      await deterministicUuid("a", "bc"),
    );
  });
});

import { describe, expect, it } from "vitest";

import {
  fitWithin,
  logoFileError,
  logoFileKind,
  RASTER_BOX,
} from "@/lib/logo-file";

describe("logo files", () => {
  it("classifies PNG/JPEG, SVG and anything else", () => {
    expect(logoFileKind({ type: "image/png", name: "a.png" })).toBe("raster");
    expect(logoFileKind({ type: "image/jpeg", name: "a.jpg" })).toBe("raster");
    expect(logoFileKind({ type: "image/svg+xml", name: "a.svg" })).toBe("svg");
    expect(logoFileKind({ type: "", name: "Logo.SVG" })).toBe("svg");
    expect(logoFileKind({ type: "image/webp", name: "a.webp" })).toBe(
      "unsupported",
    );
    expect(logoFileKind({ type: "application/pdf", name: "a.pdf" })).toBe(
      "unsupported",
    );
  });

  it("explains unsupported or oversized files", () => {
    expect(
      logoFileError({ type: "image/gif", name: "a.gif", size: 10 }),
    ).toMatch(/PNG, JPEG o SVG/);
    expect(
      logoFileError({ type: "image/png", name: "a.png", size: 3_000_000 }),
    ).toMatch(/2 MiB/);
    expect(logoFileError({ type: "image/png", name: "a.png", size: 10 })).toBe(
      null,
    );
  });

  it("fits inside the raster box keeping the aspect ratio", () => {
    expect(fitWithin(1000, 1000)).toEqual({ width: 96, height: 96 });
    expect(fitWithin(3000, 300)).toEqual({ width: 300, height: 30 });
    expect(fitWithin(10, 4000)).toEqual({ width: 1, height: 96 });
    // SVGs without intrinsic size fall back to a square.
    expect(fitWithin(0, 0)).toEqual({
      width: RASTER_BOX.height,
      height: RASTER_BOX.height,
    });
  });
});

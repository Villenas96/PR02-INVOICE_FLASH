import { describe, expect, it } from "vitest";

import {
  nextPdfPollDelayMs,
  PDF_POLL_MAX_DELAY_MS,
  PDF_POLL_TIMEOUT_MS,
  shouldKeepPollingPdf,
} from "@/components/documents/pdf-polling";

describe("PDF download polling", () => {
  it("honours the server Retry-After on the first attempts", () => {
    expect(nextPdfPollDelayMs(0, "2")).toBe(2_000);
    expect(nextPdfPollDelayMs(1, "2")).toBe(3_000);
  });

  it("backs off exponentially up to a ceiling", () => {
    const delays = Array.from({ length: 12 }, (_, attempt) =>
      nextPdfPollDelayMs(attempt, "2"),
    );

    for (let index = 1; index < delays.length; index += 1) {
      expect(delays[index]).toBeGreaterThanOrEqual(delays[index - 1] as number);
    }
    expect(delays.at(-1)).toBe(PDF_POLL_MAX_DELAY_MS);
  });

  it("never polls faster than a longer Retry-After", () => {
    expect(nextPdfPollDelayMs(0, "10")).toBe(10_000);
  });

  it("falls back to the base delay for a missing or invalid Retry-After", () => {
    expect(nextPdfPollDelayMs(0, null)).toBe(2_000);
    expect(nextPdfPollDelayMs(0, "abc")).toBe(2_000);
    expect(nextPdfPollDelayMs(0, "-5")).toBe(2_000);
  });

  it("stops polling once the time budget is spent", () => {
    expect(shouldKeepPollingPdf(0)).toBe(true);
    expect(shouldKeepPollingPdf(PDF_POLL_TIMEOUT_MS - 1)).toBe(true);
    expect(shouldKeepPollingPdf(PDF_POLL_TIMEOUT_MS)).toBe(false);
  });

  it("issues a bounded number of requests within the time budget", () => {
    let elapsed = 0;
    let requests = 0;
    while (shouldKeepPollingPdf(elapsed)) {
      elapsed += nextPdfPollDelayMs(requests, "2");
      requests += 1;
    }

    expect(requests).toBeLessThanOrEqual(25);
  });
});

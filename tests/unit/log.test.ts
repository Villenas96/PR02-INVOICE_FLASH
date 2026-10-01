import { describe, expect, it } from "vitest";

import { redactForLogs } from "@/lib/log";

describe("redactForLogs", () => {
  it("keeps a UUID request_id so logs and Sentry events can be correlated", () => {
    const requestId = "3f2b8c1e-6d4a-4f7e-9b2c-1a5d8e7f6c3b";

    expect(redactForLogs({ request_id: requestId })).toEqual({
      request_id: requestId,
    });
  });

  it("still redacts a request_id that is not a UUID", () => {
    expect(
      redactForLogs({ request_id: "Zx9_aQ2bW7cE4dR1fT6gY3hU8jI5kO0p" }),
    ).toEqual({ request_id: "[redacted-token]" });
  });

  it("redacts UUID-shaped values under any other key", () => {
    expect(
      redactForLogs({ document_id: "3f2b8c1e-6d4a-4f7e-9b2c-1a5d8e7f6c3b" }),
    ).toEqual({ document_id: "[redacted-token]" });
  });

  it("redacts share tokens, emails and Spanish tax ids inside free text", () => {
    expect(
      redactForLogs({
        detail:
          "token Zx9_aQ2bW7cE4dR1fT6gY3hU8jI5kO0pLm3nB6vC9xZ2 for ana@example.com B12345678",
      }),
    ).toEqual({
      detail: "token [redacted-token] for [redacted-email] [redacted-tax-id]",
    });
  });

  it("keeps message_type (a queue message kind) while redacting message bodies", () => {
    expect(
      redactForLogs({ message_type: "pdf.render", message: "Hola Ana" }),
    ).toEqual({ message_type: "pdf.render", message: "[redacted]" });
  });

  it("redacts every value under a sensitive key", () => {
    expect(
      redactForLogs({ amount_cents: 1250, recipient: "x", tax_id: "y" }),
    ).toEqual({
      amount_cents: "[redacted]",
      recipient: "[redacted]",
      tax_id: "[redacted]",
    });
  });
});

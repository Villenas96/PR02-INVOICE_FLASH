import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cloudflareState = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => Promise.resolve({ env: cloudflareState.env }),
}));

const { middleware } = await import("@/proxies/middleware");

const SECRET_TOKEN = "super-secret-share-token-value-000000000000";

function requestFor(pathname: string, ip: string): NextRequest {
  return new NextRequest(`http://localhost:3000${pathname}`, {
    headers: { "cf-connecting-ip": ip },
  });
}

describe("public /d/* rate limiting", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("passes requests through while under the limit", async () => {
    cloudflareState.env = {
      PUBLIC_RATE_LIMITER: { limit: () => Promise.resolve({ success: true }) },
    };
    const response = await middleware(
      requestFor(`/d/${SECRET_TOKEN}`, "1.2.3.4"),
    );
    expect(response.status).toBe(200);
  });

  it("returns 429 without logging the token once the limiter rejects the IP", async () => {
    cloudflareState.env = {
      PUBLIC_RATE_LIMITER: {
        limit: () => Promise.resolve({ success: false }),
      },
    };
    const response = await middleware(
      requestFor(`/d/${SECRET_TOKEN}`, "9.9.9.9"),
    );
    expect(response.status).toBe(429);
    expect(
      (await response.json()) as { error: { code: string } },
    ).toMatchObject({ error: { code: "validation_error" } });

    const loggedText = warnSpy.mock.calls
      .map((call: unknown[]) => call.map(String).join(" "))
      .join("\n");
    expect(loggedText).not.toContain(SECRET_TOKEN);
  });

  it("never rate-limits private application routes", async () => {
    cloudflareState.env = {
      PUBLIC_RATE_LIMITER: {
        limit: () => Promise.resolve({ success: false }),
      },
    };
    const response = await middleware(requestFor("/api/v1/company", "9.9.9.9"));
    expect(response.status).not.toBe(429);
  });

  it("skips the check entirely when the binding is unavailable, such as in local dev", async () => {
    cloudflareState.env = {};
    const response = await middleware(
      requestFor(`/d/${SECRET_TOKEN}`, "1.2.3.4"),
    );
    expect(response.status).toBe(200);
  });
});

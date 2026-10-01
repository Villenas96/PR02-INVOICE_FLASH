import { beforeEach, describe, expect, it, vi } from "vitest";

const getCloudflareContext = vi.hoisted(() => vi.fn());
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext }));

const { runInBackground } = await import("@/lib/background");

describe("runInBackground", () => {
  beforeEach(() => {
    getCloudflareContext.mockReset();
  });

  it("registers the task with the Worker's waitUntil", async () => {
    const waitUntil = vi.fn();
    getCloudflareContext.mockReturnValue({ ctx: { waitUntil } });

    runInBackground(Promise.resolve("sent"));

    expect(waitUntil).toHaveBeenCalledTimes(1);
    await expect(waitUntil.mock.calls[0]?.[0]).resolves.toBe("sent");
  });

  it("never hands waitUntil a rejecting promise", async () => {
    const waitUntil = vi.fn();
    getCloudflareContext.mockReturnValue({ ctx: { waitUntil } });

    runInBackground(Promise.reject(new Error("network down")));

    await expect(waitUntil.mock.calls[0]?.[0]).resolves.toBeUndefined();
  });

  it("does nothing extra outside a Cloudflare request context", () => {
    getCloudflareContext.mockImplementation(() => {
      throw new Error("no context");
    });

    expect(() => runInBackground(Promise.resolve())).not.toThrow();
  });
});

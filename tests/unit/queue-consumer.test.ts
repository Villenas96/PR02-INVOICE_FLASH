import { describe, expect, it, vi } from "vitest";

let resolveReport: (() => void) | undefined;
const captureException = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sentry", () => ({ captureException }));

const { processQueueBatch } = await import("@/workers/queue-consumer");
const { createPdfRenderMessage, MAX_QUEUE_RETRIES } = await import(
  "@/workers/messages"
);

describe("queue consumer Sentry reporting", () => {
  it("does not finish the batch until a terminal failure report is delivered", async () => {
    captureException.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          resolveReport = () => resolve(undefined);
        }),
    );
    const delivery = {
      body: createPdfRenderMessage(crypto.randomUUID()),
      attempts: MAX_QUEUE_RETRIES,
      ack: vi.fn(),
      retry: vi.fn(),
    };

    let finished = false;
    const batch = processQueueBatch(
      { messages: [delivery] },
      {
        renderPdf: () => Promise.reject(new Error("render failed")),
        sendEmail: () => Promise.resolve(),
      },
    ).then(() => {
      finished = true;
    });

    await vi.waitFor(() => expect(captureException).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(finished).toBe(false);

    resolveReport?.();
    await batch;
    expect(finished).toBe(true);
    expect(delivery.retry).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from "vitest";

import { dispatchJob, MissingJobHandlerError } from "@/workers/jobs";
import {
  createBillingGraceMessage,
  createExportBuildMessage,
} from "@/workers/messages";
import { processQueueBatch } from "@/workers/queue-consumer";

const ID = "0190f3b4-7c1e-7a00-8000-000000000001";

describe("jobs dispatch", () => {
  it("routes each job to its own handler", async () => {
    const grace = vi.fn(async () => {});
    const exportBuild = vi.fn(async () => {});
    const handlers = {
      "billing.grace": grace,
      "export.build": exportBuild,
    };
    await dispatchJob(createExportBuildMessage(ID), handlers);
    expect(exportBuild).toHaveBeenCalledOnce();
    expect(grace).not.toHaveBeenCalled();
  });

  it("never acknowledges a job without handler: it is retried", async () => {
    await expect(
      dispatchJob(createBillingGraceMessage(ID), {}),
    ).rejects.toBeInstanceOf(MissingJobHandlerError);

    const ack = vi.fn();
    const retry = vi.fn();
    await processQueueBatch(
      {
        messages: [
          { body: createExportBuildMessage(ID), attempts: 1, ack, retry },
        ],
      },
      {
        renderPdf: async () => {},
        sendEmail: async () => {},
        runJob: (message) => dispatchJob(message, {}),
      },
    );
    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledWith({ delaySeconds: expect.any(Number) });
  });
});

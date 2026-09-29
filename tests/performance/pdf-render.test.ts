import { describe, expect, it } from "vitest";

import { renderDocumentPdf } from "@/services/pdf/render";
import type { DocumentPdfInput } from "@/services/pdf/template";
import type { PrivateBucket } from "@/services/storage";
import { storeDocumentPdf } from "@/services/storage";
import invoiceFixture from "../fixtures/pdf/invoice-multipage.json";
import { expectP95Below } from "./report";

const ITERATIONS = 20;
const RENDER_P95_MS = 500;
const AVAILABILITY_P95_MS = 3_000;

function expandLines(): DocumentPdfInput["lines"] {
  return Array.from(
    { length: invoiceFixture.linePattern.count },
    (_, index) => {
      const position = index + 1;
      const pattern =
        position % 2 === 1
          ? invoiceFixture.linePattern.odd
          : invoiceFixture.linePattern.even;

      return {
        position,
        description: `${invoiceFixture.linePattern.descriptionPrefix} ${position.toString().padStart(2, "0")}`,
        ...pattern,
      };
    },
  );
}

function createInput(): DocumentPdfInput {
  const { linePattern: _, ...document } = invoiceFixture;
  return {
    ...document,
    documentType: "invoice",
    currency: "EUR",
    lines: expandLines(),
  };
}

function createMemoryBucket(): PrivateBucket {
  const objects = new Map<string, Uint8Array>();
  return {
    async get(key) {
      const value = objects.get(key);
      if (!value) {
        return null;
      }
      return {
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(value);
            controller.close();
          },
        }),
        httpMetadata: { contentType: "application/pdf" },
      };
    },
    async put(key, value) {
      objects.set(key, value);
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}

async function measure(action: () => Promise<void>): Promise<number> {
  const startedAt = performance.now();
  await action();
  return performance.now() - startedAt;
}

describe("PDF render performance", () => {
  it(`renders a multipage invoice with p95 under ${RENDER_P95_MS} ms`, async () => {
    const input = createInput();
    const durations: number[] = [];

    for (let index = 0; index < ITERATIONS; index += 1) {
      durations.push(
        await measure(() => renderDocumentPdf(input).then(() => undefined)),
      );
    }

    expectP95Below(durations, RENDER_P95_MS);
  });

  it(`makes a rendered PDF available in storage with p95 under ${AVAILABILITY_P95_MS} ms`, async () => {
    const input = createInput();
    const bucket = createMemoryBucket();
    const durations: number[] = [];

    for (let index = 0; index < ITERATIONS; index += 1) {
      const documentId = `perf-${index}`;
      durations.push(
        await measure(async () => {
          const bytes = await renderDocumentPdf(input);
          await storeDocumentPdf(bucket, documentId, bytes);
        }),
      );
      await expect(
        bucket.get(`documents/${documentId}/pdf/v1.pdf`),
      ).resolves.not.toBeNull();
    }

    expectP95Below(durations, AVAILABILITY_P95_MS);
  });
});

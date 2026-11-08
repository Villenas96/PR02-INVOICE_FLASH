import { describe, expect, it } from "vitest";

import {
  createBillingGraceMessage,
  createExportBuildMessage,
  createImportAnalyzeMessage,
  createImportApplyMessage,
  createPdfSampleMessage,
  createRecurringRunMessage,
  createReminderSendMessage,
  jobMessageSchema,
  parseQueueMessage,
} from "@/workers/messages";

const ID = "0190f3b4-7c1e-7a00-8000-000000000001";
const NOW = new Date("2026-10-20T05:00:00.000Z");

describe("jobs queue messages", () => {
  it.each([
    ["recurring.run", createRecurringRunMessage(ID, NOW), "cycleId"],
    ["reminder.send", createReminderSendMessage(ID, NOW), "reminderId"],
    ["export.build", createExportBuildMessage(ID, NOW), "exportJobId"],
    ["import.analyze", createImportAnalyzeMessage(ID, NOW), "importJobId"],
    ["import.apply", createImportApplyMessage(ID, NOW), "importJobId"],
    ["billing.grace", createBillingGraceMessage(ID, NOW), "companyId"],
    ["pdf.sample", createPdfSampleMessage(ID, NOW), "sampleRenderId"],
  ] as const)("%s carries only an opaque id", (type, message, idField) => {
    expect(message).toEqual({
      type,
      [idField]: ID,
      enqueuedAt: NOW.toISOString(),
    });
    expect(jobMessageSchema.parse(message)).toEqual(message);
    expect(parseQueueMessage(message)).toEqual(message);
  });

  it("rejects extra fields (no sensitive data can travel in a message)", () => {
    expect(() =>
      jobMessageSchema.parse({
        ...createRecurringRunMessage(ID, NOW),
        email: "cliente@example.test",
      }),
    ).toThrow();
    expect(() =>
      jobMessageSchema.parse({
        ...createExportBuildMessage(ID, NOW),
        amountCents: 1000,
      }),
    ).toThrow();
  });

  it("rejects non-uuid ids and unknown types", () => {
    expect(() =>
      jobMessageSchema.parse({
        type: "reminder.send",
        reminderId: "B12345678",
        enqueuedAt: NOW.toISOString(),
      }),
    ).toThrow();
    expect(() =>
      jobMessageSchema.parse({
        type: "document.delete",
        documentId: ID,
        enqueuedAt: NOW.toISOString(),
      }),
    ).toThrow();
  });
});

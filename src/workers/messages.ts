import { z } from "zod";

const opaqueId = z.string().uuid();

export const pdfRenderMessageSchema = z
  .object({
    type: z.literal("pdf.render"),
    documentId: opaqueId,
    enqueuedAt: z.string().datetime(),
  })
  .strict();

export const emailSendMessageSchema = z
  .object({
    type: z.literal("email.send"),
    deliveryId: opaqueId,
    enqueuedAt: z.string().datetime(),
  })
  .strict();

function jobSchema<TType extends string, TField extends string>(
  type: TType,
  idField: TField,
) {
  return z
    .object({
      type: z.literal(type),
      [idField]: opaqueId,
      enqueuedAt: z.string().datetime(),
    } as { type: z.ZodLiteral<TType>; enqueuedAt: z.ZodString } & Record<
      TField,
      typeof opaqueId
    >)
    .strict();
}

/** Jobs queue (`invoice-flash-jobs`): opaque ids only, strict schemas. */
export const billingGraceMessageSchema = jobSchema(
  "billing.grace",
  "companyId",
);
export const recurringRunMessageSchema = jobSchema("recurring.run", "cycleId");
export const reminderSendMessageSchema = jobSchema(
  "reminder.send",
  "reminderId",
);
export const exportBuildMessageSchema = jobSchema(
  "export.build",
  "exportJobId",
);
export const importAnalyzeMessageSchema = jobSchema(
  "import.analyze",
  "importJobId",
);
export const importApplyMessageSchema = jobSchema(
  "import.apply",
  "importJobId",
);
export const pdfSampleMessageSchema = jobSchema("pdf.sample", "sampleRenderId");

export const jobMessageSchema = z.discriminatedUnion("type", [
  billingGraceMessageSchema,
  recurringRunMessageSchema,
  reminderSendMessageSchema,
  exportBuildMessageSchema,
  importAnalyzeMessageSchema,
  importApplyMessageSchema,
  pdfSampleMessageSchema,
]);

export const queueMessageSchema = z.discriminatedUnion("type", [
  pdfRenderMessageSchema,
  emailSendMessageSchema,
  ...jobMessageSchema.options,
]);

export type PdfRenderMessage = z.infer<typeof pdfRenderMessageSchema>;
export type EmailSendMessage = z.infer<typeof emailSendMessageSchema>;
export type BillingGraceMessage = z.infer<typeof billingGraceMessageSchema>;
export type RecurringRunMessage = z.infer<typeof recurringRunMessageSchema>;
export type ReminderSendMessage = z.infer<typeof reminderSendMessageSchema>;
export type ExportBuildMessage = z.infer<typeof exportBuildMessageSchema>;
export type ImportAnalyzeMessage = z.infer<typeof importAnalyzeMessageSchema>;
export type ImportApplyMessage = z.infer<typeof importApplyMessageSchema>;
export type PdfSampleMessage = z.infer<typeof pdfSampleMessageSchema>;
export type JobMessage = z.infer<typeof jobMessageSchema>;
export type QueueMessage = z.infer<typeof queueMessageSchema>;

export const EMAIL_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_QUEUE_RETRIES = 3;
const RETRY_BASE_SECONDS = 30;
const RETRY_MAX_SECONDS = 15 * 60;

export function createPdfRenderMessage(documentId: string): PdfRenderMessage {
  return pdfRenderMessageSchema.parse({
    type: "pdf.render",
    documentId,
    enqueuedAt: new Date().toISOString(),
  });
}

export function createEmailSendMessage(deliveryId: string): EmailSendMessage {
  return emailSendMessageSchema.parse({
    type: "email.send",
    deliveryId,
    enqueuedAt: new Date().toISOString(),
  });
}

export function createBillingGraceMessage(
  companyId: string,
  now = new Date(),
): BillingGraceMessage {
  return billingGraceMessageSchema.parse({
    type: "billing.grace",
    companyId,
    enqueuedAt: now.toISOString(),
  });
}

export function createRecurringRunMessage(
  cycleId: string,
  now = new Date(),
): RecurringRunMessage {
  return recurringRunMessageSchema.parse({
    type: "recurring.run",
    cycleId,
    enqueuedAt: now.toISOString(),
  });
}

export function createReminderSendMessage(
  reminderId: string,
  now = new Date(),
): ReminderSendMessage {
  return reminderSendMessageSchema.parse({
    type: "reminder.send",
    reminderId,
    enqueuedAt: now.toISOString(),
  });
}

export function createExportBuildMessage(
  exportJobId: string,
  now = new Date(),
): ExportBuildMessage {
  return exportBuildMessageSchema.parse({
    type: "export.build",
    exportJobId,
    enqueuedAt: now.toISOString(),
  });
}

export function createImportAnalyzeMessage(
  importJobId: string,
  now = new Date(),
): ImportAnalyzeMessage {
  return importAnalyzeMessageSchema.parse({
    type: "import.analyze",
    importJobId,
    enqueuedAt: now.toISOString(),
  });
}

export function createImportApplyMessage(
  importJobId: string,
  now = new Date(),
): ImportApplyMessage {
  return importApplyMessageSchema.parse({
    type: "import.apply",
    importJobId,
    enqueuedAt: now.toISOString(),
  });
}

export function createPdfSampleMessage(
  sampleRenderId: string,
  now = new Date(),
): PdfSampleMessage {
  return pdfSampleMessageSchema.parse({
    type: "pdf.sample",
    sampleRenderId,
    enqueuedAt: now.toISOString(),
  });
}

export function parseQueueMessage(value: unknown): QueueMessage {
  return queueMessageSchema.parse(value);
}

export function retryDelaySeconds(attempt: number): number {
  return Math.min(
    RETRY_BASE_SECONDS * 2 ** Math.max(0, attempt),
    RETRY_MAX_SECONDS,
  );
}

export function canRetryEmail({
  enqueuedAt,
  authExpiresAt,
  now = new Date(),
}: {
  enqueuedAt: string;
  authExpiresAt?: Date | null;
  now?: Date;
}): boolean {
  const windowExpiresAt =
    new Date(enqueuedAt).getTime() + EMAIL_RETRY_WINDOW_MS;
  const authExpiry = authExpiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
  return now.getTime() < Math.min(windowExpiresAt, authExpiry);
}

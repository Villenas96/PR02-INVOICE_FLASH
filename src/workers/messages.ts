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

export const queueMessageSchema = z.discriminatedUnion("type", [
  pdfRenderMessageSchema,
  emailSendMessageSchema,
]);

export type PdfRenderMessage = z.infer<typeof pdfRenderMessageSchema>;
export type EmailSendMessage = z.infer<typeof emailSendMessageSchema>;
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

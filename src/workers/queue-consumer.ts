import { logSafe } from "@/lib/log";
import { captureException } from "@/lib/sentry";
import {
  canRetryEmail,
  type EmailSendMessage,
  MAX_QUEUE_RETRIES,
  type PdfRenderMessage,
  parseQueueMessage,
  type QueueMessage,
  retryDelaySeconds,
} from "@/workers/messages";

export interface QueueDelivery {
  body: unknown;
  attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

export interface QueueBatch {
  messages: QueueDelivery[];
}

export interface QueueConsumers {
  renderPdf(message: PdfRenderMessage): Promise<void>;
  sendEmail(message: EmailSendMessage): Promise<void>;
}

/** Lets purpose-aware email handlers bound retries by verification expiry. */
export class RetryableQueueError extends Error {
  constructor(
    message: string,
    public readonly retryUntil?: Date | null,
  ) {
    super(message);
  }
}

function retryOrRouteToDlq(message: QueueDelivery): void {
  // Cloudflare applies the configured max_retries and forwards the next retry to
  // the bound DLQ. The message body remains the opaque identifier-only payload.
  message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
}

export async function processQueueBatch(
  batch: QueueBatch,
  consumers: QueueConsumers,
  now = new Date(),
): Promise<void> {
  await Promise.all(
    batch.messages.map(async (delivery) => {
      let message: QueueMessage;

      try {
        message = parseQueueMessage(delivery.body);
      } catch {
        logSafe("warn", "queue.invalid_message", {
          attempts: delivery.attempts,
        });
        // Malformed messages are not retried: they are non-recoverable and must
        // not create an unbounded delivery loop.
        delivery.ack();
        return;
      }

      try {
        if (message.type === "pdf.render") {
          await consumers.renderPdf(message);
          delivery.ack();
          return;
        }

        await consumers.sendEmail(message);
        delivery.ack();
      } catch (error) {
        const retryUntil =
          error instanceof RetryableQueueError ? error.retryUntil : undefined;
        const emailRetryWindowElapsed =
          message.type === "email.send" &&
          !canRetryEmail({
            enqueuedAt: message.enqueuedAt,
            authExpiresAt: retryUntil,
            now,
          });
        const routeToDlq =
          !emailRetryWindowElapsed && delivery.attempts >= MAX_QUEUE_RETRIES;
        const terminal = emailRetryWindowElapsed || routeToDlq;

        logSafe("error", "queue.delivery_failed", {
          message_type: message.type,
          attempts: delivery.attempts,
          error_type: error instanceof Error ? error.name : "UnknownError",
          terminal,
        });
        if (terminal) {
          // Only report once retries are exhausted (DLQ) or the message can
          // no longer recover (expired auth email); transient attempts still
          // within backoff are expected and would otherwise be noisy.
          void captureException(error, {
            message_type: message.type,
            attempts: delivery.attempts,
          });
        }

        if (emailRetryWindowElapsed) {
          // The persistent delivery handler records terminal failure. Acking
          // prevents an expired auth email from reaching a retry loop.
          delivery.ack();
          return;
        }

        // Calling retry after the configured maximum delegates the message to
        // Cloudflare's bound DLQ. Earlier attempts receive exponential backoff.
        retryOrRouteToDlq(delivery);
      }
    }),
  );
}

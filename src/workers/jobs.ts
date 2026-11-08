import type { JobMessage } from "@/workers/messages";

type JobType = JobMessage["type"];

/** One handler per job type of the `invoice-flash-jobs` queue. */
export type JobHandlers = {
  [TType in JobType]?: (
    message: Extract<JobMessage, { type: TType }>,
  ) => Promise<void>;
};

export class MissingJobHandlerError extends Error {
  constructor(public readonly jobType: JobType) {
    super(`No hay manejador para el trabajo ${jobType}.`);
    this.name = "MissingJobHandlerError";
  }
}

/**
 * Routes a job to its handler. A type without handler throws instead of
 * being acknowledged, so the message is retried with backoff and ends in
 * the DLQ rather than being silently dropped.
 */
export async function dispatchJob(
  message: JobMessage,
  handlers: JobHandlers,
): Promise<void> {
  const handler = handlers[message.type] as
    | ((message: JobMessage) => Promise<void>)
    | undefined;
  if (!handler) {
    throw new MissingJobHandlerError(message.type);
  }
  await handler(message);
}

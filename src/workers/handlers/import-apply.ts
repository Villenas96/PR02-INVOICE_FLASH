import { applyImport, type ImportJobDependencies } from "@/services/imports";
import type { ImportApplyMessage } from "@/workers/messages";

/** `import.apply`: batches of 500, resumable after redelivery. */
export function handleImportApply(
  message: ImportApplyMessage,
  dependencies: ImportJobDependencies,
): Promise<void> {
  return applyImport(message.importJobId, dependencies);
}

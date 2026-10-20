import { analyzeImport, type ImportJobDependencies } from "@/services/imports";
import type { ImportAnalyzeMessage } from "@/workers/messages";

/** `import.analyze`: preview only, nothing is created (FR-031). */
export function handleImportAnalyze(
  message: ImportAnalyzeMessage,
  dependencies: ImportJobDependencies,
): Promise<void> {
  return analyzeImport(message.importJobId, dependencies);
}

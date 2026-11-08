import { buildExport, type ExportBuildDependencies } from "@/services/exports";
import type { ExportBuildMessage } from "@/workers/messages";

/** `export.build`: XLSX/ZIP, download link and optional advisor email. */
export function handleExportBuild(
  message: ExportBuildMessage,
  dependencies: ExportBuildDependencies,
): Promise<void> {
  return buildExport(message.exportJobId, dependencies);
}

import {
  renderSample,
  type SampleRenderDependencies,
} from "@/services/onboarding";
import type { PdfSampleMessage } from "@/workers/messages";

/** `pdf.sample`: watermarked sample invoice of the setup wizard (FR-049). */
export function handlePdfSample(
  message: PdfSampleMessage,
  dependencies: SampleRenderDependencies,
): Promise<void> {
  return renderSample(message.sampleRenderId, dependencies);
}

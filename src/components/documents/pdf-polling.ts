/**
 * Polling policy for the asynchronous PDF download (plan: `202
 * pdf_processing` + `Retry-After`). PDFs are normally ready within seconds
 * (p95 < 3 s), so the client backs off and gives up after a time budget
 * instead of polling forever when a PDF never becomes available.
 */
const PDF_POLL_BASE_DELAY_MS = 2_000;
const PDF_POLL_BACKOFF = 1.5;
export const PDF_POLL_MAX_DELAY_MS = 15_000;
export const PDF_POLL_TIMEOUT_MS = 3 * 60_000;

export function nextPdfPollDelayMs(
  attempt: number,
  retryAfterHeader: string | null,
): number {
  const retryAfterSeconds = Number(retryAfterHeader);
  const serverDelayMs =
    Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1_000
      : PDF_POLL_BASE_DELAY_MS;
  const backoffMs = PDF_POLL_BASE_DELAY_MS * PDF_POLL_BACKOFF ** attempt;

  return Math.min(Math.max(serverDelayMs, backoffMs), PDF_POLL_MAX_DELAY_MS);
}

export function shouldKeepPollingPdf(elapsedMs: number): boolean {
  return elapsedMs < PDF_POLL_TIMEOUT_MS;
}

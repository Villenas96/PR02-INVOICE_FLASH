/**
 * Where the E2E suite runs. Locally (default) it targets the preview on
 * 127.0.0.1:3000 and uses non-deliverable `example.test` addresses. Against a
 * deployed environment (playwright.staging.config.ts) emails go to Resend's
 * test inbox, so real sending never bounces.
 */
export function appOrigin(): string {
  return process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
}

/** A test recipient for `localPart`, unique per caller. */
export function testEmail(localPart: string): string {
  return process.env.E2E_EMAIL_SINK === "resend"
    ? `delivered+${localPart}@resend.dev`
    : `${localPart}@example.test`;
}

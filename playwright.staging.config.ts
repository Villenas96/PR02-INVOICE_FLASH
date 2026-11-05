import { defineConfig, devices } from "@playwright/test";

/**
 * The E2E suite against a deployed environment (staging only), for the
 * quickstart validation (T189). Unlike playwright.config.ts it starts no
 * server and has no global setup: nothing is truncated. Tests create their
 * own accounts; emails go to Resend's test inbox (E2E_EMAIL_SINK=resend).
 *
 *   E2E_BASE_URL=https://<staging host> E2E_DATABASE_URL=<staging db> \
 *     pnpm test:e2e:staging
 */
const baseURL = process.env.E2E_BASE_URL ?? "";
if (!baseURL.startsWith("https://") || !baseURL.includes("staging")) {
  throw new Error("E2E_BASE_URL debe ser la URL https de staging.");
}
if (process.env.E2E_EMAIL_SINK !== "resend") {
  throw new Error("E2E_EMAIL_SINK=resend es obligatorio fuera de local.");
}
if (/localhost|127\.0\.0\.1/.test(process.env.E2E_DATABASE_URL ?? "")) {
  throw new Error("E2E_DATABASE_URL debe ser la base de staging.");
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  // One worker keeps sign-ups under Better Auth's per-IP rate limit.
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report-staging" }],
  ],
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
});

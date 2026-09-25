import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: [
    {
      command: "node tests/e2e/neon-http-proxy.mjs",
      url: "http://127.0.0.1:55433/health",
      reuseExistingServer: !process.env.CI,
      timeout: 10_000,
    },
    {
      command:
        "DATABASE_URL=$E2E_DATABASE_URL pnpm preview -- --port 3000 --var DATABASE_URL:$E2E_DATABASE_URL --var BETTER_AUTH_SECRET:$E2E_BETTER_AUTH_SECRET --var BETTER_AUTH_URL:http://127.0.0.1:3000 --var NEON_HTTP_ENDPOINT:http://127.0.0.1:55433/sql --var E2E_DISABLE_AUTH_RATE_LIMIT:true",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          fileParallelism: false,
          testTimeout: 30000,
          setupFiles: ["tests/integration/setup.ts"],
          globalSetup: ["tests/integration/global-teardown.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "performance",
          environment: "node",
          include: ["tests/performance/**/*.test.ts"],
          // Every performance file shares one Postgres database and
          // truncates it before seeding its own fixture; running files
          // concurrently would let one file's truncation wipe another's
          // in-progress data.
          fileParallelism: false,
          testTimeout: 60000,
          // Same migrate-first + ephemeral-cleanup lifecycle as the
          // integration project, so the suite runs against a fresh database.
          globalSetup: ["tests/integration/global-teardown.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Pure business-logic modules only (constitution: "Lógica de negocio
      // pura en src/lib/* con pruebas unitarias obligatorias") — this
      // deliberately excludes thin infra/glue (auth, log, sentry, the
      // generic api/* request helpers) whose real coverage comes from the
      // integration suite, not unit tests.
      include: [
        "src/lib/billing/**",
        "src/lib/documents/**",
        "src/lib/money/**",
        "src/lib/numbering/**",
        "src/lib/payments/**",
        "src/lib/plan.ts",
        "src/lib/share-links.ts",
      ],
      // Floor set at today's achieved level (with a small margin) so CI
      // fails on any real regression; raise it whenever coverage improves,
      // never lower it to make a drop pass.
      thresholds: {
        statements: 90,
        branches: 80,
        functions: 100,
        lines: 90,
      },
    },
  },
});

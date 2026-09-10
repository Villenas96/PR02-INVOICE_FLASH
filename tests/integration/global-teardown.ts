import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import {
  closeIntegrationDatabase,
  integrationDatabaseUrl,
  truncateIntegrationDatabase,
} from "./database";

const execFileAsync = promisify(execFile);

type CleanupTarget = "docker" | "neon" | "none";

function cleanupTarget(): CleanupTarget {
  const value = process.env.INTEGRATION_CLEANUP_TARGET ?? "none";
  if (value === "docker" || value === "neon" || value === "none") {
    return value;
  }
  throw new Error("INTEGRATION_CLEANUP_TARGET debe ser docker, neon o none.");
}

async function removeDockerContainer(): Promise<void> {
  const container = process.env.INTEGRATION_POSTGRES_CONTAINER;
  if (!container?.startsWith("invoice-flash-test-")) {
    throw new Error(
      "INTEGRATION_POSTGRES_CONTAINER debe empezar por invoice-flash-test-.",
    );
  }
  await execFileAsync("docker", ["rm", "--force", container]);
}

async function removeNeonBranch(): Promise<void> {
  const projectId = process.env.NEON_PROJECT_ID;
  const branchId = process.env.INTEGRATION_NEON_BRANCH_ID;
  const apiKey = process.env.NEON_API_KEY;

  if (!projectId || !branchId || !apiKey) {
    throw new Error(
      "NEON_PROJECT_ID, INTEGRATION_NEON_BRANCH_ID y NEON_API_KEY son obligatorios para limpiar la rama efímera.",
    );
  }

  const response = await fetch(
    `https://console.neon.tech/api/v2/projects/${projectId}/branches/${branchId}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${apiKey}` } },
  );

  if (!response.ok && response.status !== 404) {
    throw new Error(
      `No se ha podido limpiar la rama efímera de Neon (${response.status}).`,
    );
  }
}

async function cleanupEphemeralDatabase(target: CleanupTarget): Promise<void> {
  if (target === "docker") {
    await removeDockerContainer();
  }
  if (target === "neon") {
    await removeNeonBranch();
  }
}

export default async function integrationGlobalSetup() {
  const databaseUrl = integrationDatabaseUrl();
  const migrationClient = postgres(databaseUrl, { max: 1 });
  try {
    await migrate(drizzle(migrationClient), {
      migrationsFolder: resolve("src/db/migrations"),
    });
  } finally {
    await migrationClient.end({ timeout: 5 });
  }

  const target = cleanupTarget();
  return async () => {
    try {
      await truncateIntegrationDatabase();
    } finally {
      try {
        await closeIntegrationDatabase();
      } finally {
        await cleanupEphemeralDatabase(target);
      }
    }
  };
}

/**
 * Data step of migration 0007_logos (specs/002 research R10): copies each
 * company logo stored under a v1 key (`companies/{id}/logos/{uuid}.{ext}`)
 * to its content-addressed key `logos/{company_id}/{sha256}.{ext}` and
 * points `company.logo_key` at it. Old objects are left in place because
 * issued documents may still reference them in their frozen snapshots.
 *
 * Idempotent: companies already on a `logos/` key are skipped and the
 * update is a compare-and-swap on the old key.
 *
 * Usage (never prints secrets):
 *   DATABASE_URL='<url>' pnpm exec node --experimental-strip-types \
 *     scripts/migrate-logos.ts --bucket invoice-flash-storage \
 *     --jurisdiction eu [--dry-run]
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { neon } from "@neondatabase/serverless";

const execFileAsync = promisify(execFile);

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
};

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function wrangler(args: string[]): Promise<void> {
  await execFileAsync("pnpm", ["exec", "wrangler", ...args], {
    maxBuffer: 16 * 1024 * 1024,
  });
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const bucket = argument("bucket");
  const jurisdiction = argument("jurisdiction");
  const dryRun = process.argv.includes("--dry-run");
  if (!databaseUrl || !bucket) {
    throw new Error("DATABASE_URL and --bucket are required");
  }
  const jurisdictionArgs = jurisdiction ? ["--jurisdiction", jurisdiction] : [];
  const query = neon(databaseUrl);
  const rows = (await query`
    SELECT id, logo_key FROM company
    WHERE logo_key IS NOT NULL AND logo_key NOT LIKE 'logos/%'
  `) as Array<{ id: string; logo_key: string }>;

  const workdir = await mkdtemp(join(tmpdir(), "factum-logos-"));
  let migrated = 0;
  try {
    for (const row of rows) {
      const extension = row.logo_key.split(".").at(-1)?.toLowerCase() ?? "";
      const contentType = CONTENT_TYPES[extension];
      if (!contentType) {
        console.warn(`skip company ${row.id}: unknown logo extension`);
        continue;
      }
      const file = join(workdir, `${row.id}.${extension}`);
      await wrangler([
        "r2",
        "object",
        "get",
        `${bucket}/${row.logo_key}`,
        "--file",
        file,
        "--remote",
        ...jurisdictionArgs,
      ]);
      const bytes = await readFile(file);
      const digest = createHash("sha256").update(bytes).digest("hex");
      const target = `logos/${row.id}/${digest}.${extension === "jpeg" ? "jpg" : extension}`;
      if (dryRun) {
        console.info(`would migrate company ${row.id} -> ${target}`);
        continue;
      }
      await wrangler([
        "r2",
        "object",
        "put",
        `${bucket}/${target}`,
        "--file",
        file,
        "--content-type",
        contentType,
        "--remote",
        ...jurisdictionArgs,
      ]);
      await query`
        UPDATE company SET logo_key = ${target}, updated_at = now()
        WHERE id = ${row.id} AND logo_key = ${row.logo_key}
      `;
      migrated += 1;
    }
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
  console.info(
    `${dryRun ? "Dry run" : "Done"}: ${rows.length} candidate(s), ${migrated} migrated.`,
  );
}

main().catch((error: unknown) => {
  console.error(
    `Logo migration failed: ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exitCode = 1;
});

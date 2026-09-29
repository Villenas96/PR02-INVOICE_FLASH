import { readFile } from "node:fs/promises";
import { z } from "zod";

const MAX_EVIDENCE_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const EVENT_ID_PATTERN = /^[a-f0-9]{32}$/i;

const evidenceReferenceSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://"), {
    message: "must use HTTPS",
  });

const timestampSchema = z.iso.datetime({ offset: true });

const baseCostSchema = z.object({
  evidenceUrl: evidenceReferenceSchema,
  usageMonitoringEnabled: z.literal(true),
});

const evidenceSchema = z.object({
  schemaVersion: z.literal(1),
  environment: z.enum(["staging", "production"]),
  reviewedBy: z.string().trim().min(1),
  verifiedAt: timestampSchema,
  validUntil: timestampSchema,
  sentry: z.object({
    dsnConfigured: z.literal(true),
    requestIdCorrelationVerified: z.literal(true),
    requestId: z.uuid(),
    testEventId: z.string().regex(EVENT_ID_PATTERN),
    eventReceivedAt: timestampSchema,
    evidenceUrl: evidenceReferenceSchema,
  }),
  neon: z.object({
    tlsConnectionVerifiedAt: timestampSchema,
    encryptionAtRestVerified: z.literal(true),
    encryptionEvidenceUrl: evidenceReferenceSchema,
    ciBranchCleanup: z.object({
      enabled: z.literal(true),
      mode: z.enum(["expiration", "automated-deletion"]),
      verifiedAt: timestampSchema,
      evidenceUrl: evidenceReferenceSchema,
    }),
  }),
  r2: z.object({
    bucketName: z.string().trim().min(1),
    bindingName: z.literal("STORAGE_BUCKET"),
    privateAccess: z.literal(true),
    publicDevelopmentUrlDisabled: z.literal(true),
    customDomainsDisabled: z.literal(true),
    httpsOnly: z.literal(true),
    encryptionAtRest: z.literal("AES-256-GCM"),
    verifiedAt: timestampSchema,
    evidenceUrl: evidenceReferenceSchema,
  }),
  cloudflareCost: z.object({
    budgetAlertEnabled: z.literal(true),
    thresholdUsdCents: z.number().int().positive(),
    recipientCount: z.number().int().positive(),
    alertDeliveryTestedAt: timestampSchema,
    evidenceUrl: evidenceReferenceSchema,
  }),
  neonCost: z.discriminatedUnion("plan", [
    baseCostSchema.extend({
      plan: z.literal("free"),
      billingSpendPossible: z.literal(false),
      limitsReviewedAt: timestampSchema,
    }),
    baseCostSchema.extend({
      plan: z.literal("paid"),
      spendingLimitEnabled: z.literal(true),
      spendingLimitUsdCents: z.number().int().positive(),
      alertThresholdPercent: z
        .array(z.number().int())
        .refine(
          (thresholds) => thresholds.includes(80) && thresholds.includes(100),
          { message: "must include the 80% and 100% thresholds" },
        ),
      alertDeliveryTestedAt: timestampSchema,
    }),
  ]),
});

interface CheckResult {
  detail: string;
  name: string;
}

function requireEnvironment(
  name:
    | "DATABASE_URL"
    | "DEPLOY_ENVIRONMENT"
    | "PREDEPLOY_EVIDENCE_FILE"
    | "SENTRY_DSN",
): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function parseHttpsSentryDsn(value: string): URL {
  let dsn: URL;
  try {
    dsn = new URL(value);
  } catch {
    throw new Error("SENTRY_DSN must be a valid URL");
  }

  const projectId = dsn.pathname.split("/").filter(Boolean).at(-1);
  if (dsn.protocol !== "https:" || !dsn.username || !projectId) {
    throw new Error(
      "SENTRY_DSN must use HTTPS and include a public key and project id",
    );
  }

  return dsn;
}

function parseNeonDatabaseUrl(value: string): URL {
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid URL");
  }

  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) {
    throw new Error("DATABASE_URL must use the postgres protocol");
  }

  if (
    databaseUrl.hostname !== "neon.tech" &&
    !databaseUrl.hostname.endsWith(".neon.tech")
  ) {
    throw new Error("DATABASE_URL must target a Neon hostname");
  }

  const sslMode = databaseUrl.searchParams.get("sslmode");
  if (sslMode !== "require" && sslMode !== "verify-full") {
    throw new Error(
      "DATABASE_URL must set sslmode=require or sslmode=verify-full",
    );
  }

  return databaseUrl;
}

function checkTimestamp(
  label: string,
  value: string,
  now: number,
): CheckResult {
  const timestamp = Date.parse(value);
  if (timestamp > now + MAX_CLOCK_SKEW_MS) {
    throw new Error(`${label} is in the future`);
  }
  if (now - timestamp > MAX_EVIDENCE_AGE_MS) {
    throw new Error(`${label} is older than 30 days`);
  }

  return { name: label, detail: value };
}

async function readEvidence(
  path: string,
): Promise<z.infer<typeof evidenceSchema>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(`cannot read PREDEPLOY_EVIDENCE_FILE at ${path}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("PREDEPLOY_EVIDENCE_FILE must contain valid JSON");
  }

  const result = evidenceSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "evidence"}: ${issue.message}`)
      .join("; ");
    throw new Error(`invalid pre-deploy evidence: ${details}`);
  }

  return result.data;
}

async function main(): Promise<void> {
  const environment = requireEnvironment("DEPLOY_ENVIRONMENT");
  if (environment !== "staging" && environment !== "production") {
    throw new Error("DEPLOY_ENVIRONMENT must be staging or production");
  }

  const evidencePath = requireEnvironment("PREDEPLOY_EVIDENCE_FILE");
  const evidence = await readEvidence(evidencePath);
  if (evidence.environment !== environment) {
    throw new Error(
      `evidence environment ${evidence.environment} does not match ${environment}`,
    );
  }

  const now = Date.now();
  if (Date.parse(evidence.validUntil) <= now) {
    throw new Error("pre-deploy evidence has expired");
  }
  if (Date.parse(evidence.validUntil) <= Date.parse(evidence.verifiedAt)) {
    throw new Error("validUntil must be later than verifiedAt");
  }

  const sentryDsn = parseHttpsSentryDsn(requireEnvironment("SENTRY_DSN"));
  const databaseUrl = parseNeonDatabaseUrl(requireEnvironment("DATABASE_URL"));

  const timestampChecks = [
    checkTimestamp("verifiedAt", evidence.verifiedAt, now),
    checkTimestamp(
      "sentry.eventReceivedAt",
      evidence.sentry.eventReceivedAt,
      now,
    ),
    checkTimestamp(
      "neon.tlsConnectionVerifiedAt",
      evidence.neon.tlsConnectionVerifiedAt,
      now,
    ),
    checkTimestamp(
      "neon.ciBranchCleanup.verifiedAt",
      evidence.neon.ciBranchCleanup.verifiedAt,
      now,
    ),
    checkTimestamp("r2.verifiedAt", evidence.r2.verifiedAt, now),
    checkTimestamp(
      "cloudflareCost.alertDeliveryTestedAt",
      evidence.cloudflareCost.alertDeliveryTestedAt,
      now,
    ),
    checkTimestamp(
      evidence.neonCost.plan === "free"
        ? "neonCost.limitsReviewedAt"
        : "neonCost.alertDeliveryTestedAt",
      evidence.neonCost.plan === "free"
        ? evidence.neonCost.limitsReviewedAt
        : evidence.neonCost.alertDeliveryTestedAt,
      now,
    ),
  ];

  const checks: CheckResult[] = [
    {
      name: "Sentry configuration",
      detail: `${sentryDsn.host} with request_id correlation evidence`,
    },
    {
      name: "Neon TLS",
      detail: `${databaseUrl.hostname} (${databaseUrl.searchParams.get("sslmode")})`,
    },
    {
      name: "Neon encryption and CI cleanup",
      detail: evidence.neon.ciBranchCleanup.mode,
    },
    {
      name: "R2 privacy and encryption",
      detail: `${evidence.r2.bucketName} is private and ${evidence.r2.encryptionAtRest}`,
    },
    {
      name: "Cloudflare cost alert",
      detail: `${evidence.cloudflareCost.thresholdUsdCents} USD cents, ${evidence.cloudflareCost.recipientCount} recipient(s)`,
    },
    {
      name: "Neon cost control",
      detail:
        evidence.neonCost.plan === "free"
          ? "Free plan limits monitored; no billable spend"
          : `${evidence.neonCost.spendingLimitUsdCents} USD cents limit; 80%/100% alerts`,
    },
    ...timestampChecks,
  ];

  console.log(`Pre-deploy verification passed for ${environment}.`);
  for (const check of checks) {
    console.log(`PASS ${check.name}: ${check.detail}`);
  }
  console.log(
    "Evidence reviewer recorded; references only, no secrets printed.",
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`Pre-deploy verification failed: ${message}`);
  process.exitCode = 1;
});

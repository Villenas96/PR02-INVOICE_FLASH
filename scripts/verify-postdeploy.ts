import { readFile } from "node:fs/promises";
import { z } from "zod";

const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const EVENT_ID_PATTERN = /^[a-f0-9]{32}$/i;
const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 InvoiceFlashDeployCheck/1.0";

const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://"), {
    message: "must use HTTPS",
  });

const timestampSchema = z.iso.datetime({ offset: true });

const evidenceSchema = z.object({
  schemaVersion: z.literal(1),
  environment: z.enum(["staging", "production"]),
  deployment: z.object({
    id: z.string().trim().min(1),
    baseUrl: httpsUrlSchema,
    deployedAt: timestampSchema,
    evidenceUrl: httpsUrlSchema,
  }),
  mobileSmoke: z.object({
    passed: z.literal(true),
    checkedBy: z.string().trim().min(1),
    checkedAt: timestampSchema,
    viewport: z.object({
      width: z.number().int().min(320).max(767),
      height: z.number().int().min(568),
    }),
    evidenceUrl: httpsUrlSchema,
  }),
  sentry: z.object({
    testEventId: z.string().regex(EVENT_ID_PATTERN),
    requestId: z.uuid(),
    triggeredAt: timestampSchema,
    receivedAt: timestampSchema,
    evidenceUrl: httpsUrlSchema,
  }),
});

interface SentryEvent {
  eventID?: unknown;
  id?: unknown;
  tags?: unknown;
}

function requireEnvironment(
  name:
    | "DEPLOY_BASE_URL"
    | "DEPLOY_ENVIRONMENT"
    | "POSTDEPLOY_EVIDENCE_FILE"
    | "SENTRY_AUTH_TOKEN"
    | "SENTRY_ORG_SLUG"
    | "SENTRY_PROJECT_SLUG",
): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function parseHttpsUrl(name: string, value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }

  if (url.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS`);
  }

  return url;
}

function checkFreshTimestamp(label: string, value: string, now: number): void {
  const timestamp = Date.parse(value);
  if (timestamp > now + MAX_CLOCK_SKEW_MS) {
    throw new Error(`${label} is in the future`);
  }
  if (now - timestamp > MAX_EVIDENCE_AGE_MS) {
    throw new Error(`${label} is older than 24 hours`);
  }
}

async function readEvidence(
  path: string,
): Promise<z.infer<typeof evidenceSchema>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(`cannot read POSTDEPLOY_EVIDENCE_FILE at ${path}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("POSTDEPLOY_EVIDENCE_FILE must contain valid JSON");
  }

  const result = evidenceSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "evidence"}: ${issue.message}`)
      .join("; ");
    throw new Error(`invalid post-deploy evidence: ${details}`);
  }

  return result.data;
}

async function verifyMobileResponse(baseUrl: URL): Promise<void> {
  const response = await fetch(baseUrl, {
    headers: {
      accept: "text/html",
      "cache-control": "no-cache",
      "user-agent": MOBILE_USER_AGENT,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`mobile smoke returned HTTP ${response.status}`);
  }
  if (new URL(response.url).protocol !== "https:") {
    throw new Error("mobile smoke redirected outside HTTPS");
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html")) {
    throw new Error(
      `mobile smoke expected HTML, received ${contentType || "unknown"}`,
    );
  }

  const body = await response.text();
  if (!/<meta[^>]+name=["']viewport["'][^>]*>/i.test(body)) {
    throw new Error("mobile smoke response is missing the viewport meta tag");
  }
}

function hasRequestIdTag(tags: unknown, requestId: string): boolean {
  if (Array.isArray(tags)) {
    return tags.some(
      (tag) =>
        typeof tag === "object" &&
        tag !== null &&
        "key" in tag &&
        "value" in tag &&
        tag.key === "request_id" &&
        tag.value === requestId,
    );
  }

  return (
    typeof tags === "object" &&
    tags !== null &&
    "request_id" in tags &&
    tags.request_id === requestId
  );
}

async function verifySentryEvent(
  evidence: z.infer<typeof evidenceSchema>["sentry"],
): Promise<void> {
  const org = encodeURIComponent(requireEnvironment("SENTRY_ORG_SLUG"));
  const project = encodeURIComponent(requireEnvironment("SENTRY_PROJECT_SLUG"));
  const token = requireEnvironment("SENTRY_AUTH_TOKEN");
  const apiBaseUrl = parseHttpsUrl(
    "SENTRY_API_BASE_URL",
    process.env.SENTRY_API_BASE_URL?.trim() || "https://sentry.io",
  );
  const eventUrl = new URL(
    `/api/0/projects/${org}/${project}/events/${evidence.testEventId}/`,
    apiBaseUrl,
  );

  const response = await fetch(eventUrl, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Sentry event lookup returned HTTP ${response.status}`);
  }

  const event = (await response.json()) as SentryEvent;
  const returnedEventId =
    typeof event.eventID === "string"
      ? event.eventID
      : typeof event.id === "string"
        ? event.id
        : undefined;
  if (returnedEventId?.toLowerCase() !== evidence.testEventId.toLowerCase()) {
    throw new Error("Sentry returned a different event id");
  }
  if (!hasRequestIdTag(event.tags, evidence.requestId)) {
    throw new Error("Sentry event is missing the expected request_id tag");
  }
}

async function main(): Promise<void> {
  const environment = requireEnvironment("DEPLOY_ENVIRONMENT");
  if (environment !== "staging" && environment !== "production") {
    throw new Error("DEPLOY_ENVIRONMENT must be staging or production");
  }

  const evidence = await readEvidence(
    requireEnvironment("POSTDEPLOY_EVIDENCE_FILE"),
  );
  if (evidence.environment !== environment) {
    throw new Error(
      `evidence environment ${evidence.environment} does not match ${environment}`,
    );
  }

  const baseUrl = parseHttpsUrl(
    "DEPLOY_BASE_URL",
    requireEnvironment("DEPLOY_BASE_URL"),
  );
  if (
    baseUrl.origin !== new URL(evidence.deployment.baseUrl).origin ||
    baseUrl.pathname !== new URL(evidence.deployment.baseUrl).pathname
  ) {
    throw new Error("DEPLOY_BASE_URL does not match deployment evidence");
  }

  const now = Date.now();
  checkFreshTimestamp(
    "deployment.deployedAt",
    evidence.deployment.deployedAt,
    now,
  );
  checkFreshTimestamp(
    "mobileSmoke.checkedAt",
    evidence.mobileSmoke.checkedAt,
    now,
  );
  checkFreshTimestamp("sentry.triggeredAt", evidence.sentry.triggeredAt, now);
  checkFreshTimestamp("sentry.receivedAt", evidence.sentry.receivedAt, now);

  const deployedAt = Date.parse(evidence.deployment.deployedAt);
  const triggeredAt = Date.parse(evidence.sentry.triggeredAt);
  const receivedAt = Date.parse(evidence.sentry.receivedAt);
  if (triggeredAt < deployedAt) {
    throw new Error("Sentry test event was triggered before this deployment");
  }
  if (receivedAt < triggeredAt) {
    throw new Error("Sentry event receivedAt is earlier than triggeredAt");
  }

  await verifyMobileResponse(baseUrl);
  console.log(
    `PASS mobile HTTPS smoke: ${evidence.mobileSmoke.viewport.width}x${evidence.mobileSmoke.viewport.height}; reviewer recorded.`,
  );

  await verifySentryEvent(evidence.sentry);
  console.log(
    `PASS Sentry event ${evidence.sentry.testEventId} contains the expected request_id tag.`,
  );
  console.log(
    `Post-deploy verification passed for ${environment} deployment ${evidence.deployment.id}.`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`Post-deploy verification failed: ${message}`);
  process.exitCode = 1;
});

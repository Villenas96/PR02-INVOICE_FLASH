/**
 * Sends one controlled test event through the app's own Sentry client
 * (src/lib/sentry.ts) for the pre-deploy evidence: proves the DSN works and
 * that events carry the request_id tag. The event holds no fiscal, personal
 * or authentication data: only an error type and the request_id.
 *
 * Usage: SENTRY_DSN=<dsn> pnpm sentry:test-event
 */
import { captureException } from "@/lib/sentry";

class PredeployVerificationTest extends Error {
  override name = "PredeployVerificationTest";
}

async function main(): Promise<void> {
  if (!process.env.SENTRY_DSN?.trim()) {
    throw new Error("SENTRY_DSN es obligatorio");
  }

  const requestId = crypto.randomUUID();
  const triggeredAt = new Date().toISOString();
  const eventId = await captureException(new PredeployVerificationTest(), {
    request_id: requestId,
    check: "predeploy",
  });

  if (!eventId) {
    throw new Error("Sentry no aceptó el evento de prueba (revisa el DSN)");
  }

  console.log("Evento de prueba aceptado por Sentry.");
  console.log(
    JSON.stringify({ requestId, testEventId: eventId, triggeredAt }, null, 2),
  );
  console.log(
    `Búscalo en Sentry con: request_id:${requestId} y anota cuándo aparece (eventReceivedAt).`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`Sentry test event failed: ${message}`);
  process.exitCode = 1;
});

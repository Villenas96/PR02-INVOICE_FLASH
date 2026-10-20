import { apiErrorResponse, toApiError } from "@/lib/api/errors";
import { logSafe } from "@/lib/log";

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;

/**
 * Shared shell for v2 route handlers: propagates a safe `x-request-id`,
 * funnels every error through `apiErrorResponse` and logs only unexpected
 * failures (never payloads).
 */
export async function runRoute(
  request: Request,
  event: string,
  handler: () => Promise<Response>,
): Promise<Response> {
  const supplied = request.headers.get("x-request-id");
  const propagated =
    supplied && REQUEST_ID_PATTERN.test(supplied) ? supplied : undefined;
  const requestId = propagated ?? crypto.randomUUID();

  let response: Response;
  try {
    response = await handler();
  } catch (error) {
    const apiError = toApiError(error);
    if (apiError.status >= 500) {
      logSafe("error", event, {
        request_id: requestId,
        error_type: error instanceof Error ? error.name : "UnknownError",
      });
    }
    response = apiErrorResponse(apiError, propagated);
  }
  response.headers.set("x-request-id", requestId);
  return response;
}

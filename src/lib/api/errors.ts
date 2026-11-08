import { runInBackground } from "@/lib/background";
import { captureException } from "@/lib/sentry";

export type ApiErrorCode =
  | "advisor_access_suspended"
  | "authentication_required"
  | "company_incomplete"
  | "confirmation_expired"
  | "confirmation_required"
  | "conflict"
  | "conversion_not_allowed"
  | "conversion_repeat_confirmation_required"
  | "delivery_note_already_invoiced"
  | "export_empty"
  | "feature_not_in_plan"
  | "iban_invalid"
  | "idempotency_key_invalid"
  | "import_too_large"
  | "internal_error"
  | "overpayment_confirmation_required"
  | "pdf_generation_failed"
  | "plan_limit_reached"
  | "plan_not_available"
  | "read_only_access"
  | "resource_not_found"
  | "series_archived"
  | "validation_error";

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Necesitas iniciar sesión para continuar.");
  }
}

export class ResourceNotFoundError extends Error {
  constructor() {
    super("No se ha encontrado el recurso solicitado.");
  }
}

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: number,
    message: string,
    public readonly fields?: Record<string, string>,
    /** Machine-readable context for the client (e.g. quota usage, the
     * feature and plan needed); never contains personal data. */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof AuthenticationRequiredError) {
    return new ApiError("authentication_required", 401, error.message);
  }

  if (error instanceof ResourceNotFoundError) {
    return new ApiError("resource_not_found", 404, error.message);
  }

  return new ApiError(
    "internal_error",
    500,
    "Ha ocurrido un error inesperado.",
  );
}

/**
 * Every API route funnels its error responses through this single function,
 * making it the one place that needs to report unexpected (5xx) failures to
 * Sentry — no route handler has to remember to call it individually.
 */
export function apiErrorResponse(error: unknown, requestId?: string): Response {
  const apiError = toApiError(error);

  if (apiError.status >= 500) {
    runInBackground(
      captureException(apiError, {
        request_id: requestId,
        error_code: apiError.code,
      }),
    );
  }

  return Response.json(
    {
      error: {
        code: apiError.code,
        message: apiError.message,
        fields: apiError.fields,
        details: apiError.details,
        requestId,
      },
    },
    { status: apiError.status },
  );
}

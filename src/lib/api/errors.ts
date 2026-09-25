export type ApiErrorCode =
  | "authentication_required"
  | "company_incomplete"
  | "conflict"
  | "idempotency_key_invalid"
  | "internal_error"
  | "pdf_generation_failed"
  | "plan_limit_reached"
  | "resource_not_found"
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

export function apiErrorResponse(error: unknown, requestId?: string): Response {
  const apiError = toApiError(error);

  return Response.json(
    {
      error: {
        code: apiError.code,
        message: apiError.message,
        fields: apiError.fields,
        requestId,
      },
    },
    { status: apiError.status },
  );
}

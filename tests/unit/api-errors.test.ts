import { beforeEach, describe, expect, it, vi } from "vitest";

const captureException = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/sentry", () => ({ captureException }));

const {
  ApiError,
  AuthenticationRequiredError,
  ResourceNotFoundError,
  apiErrorResponse,
  toApiError,
} = await import("@/lib/api/errors");

describe("toApiError", () => {
  it("returns an ApiError instance unchanged", () => {
    const error = new ApiError("conflict", 409, "Ya existe.");
    expect(toApiError(error)).toBe(error);
  });

  it("maps AuthenticationRequiredError to a 401 authentication_required error", () => {
    const apiError = toApiError(new AuthenticationRequiredError());
    expect(apiError.code).toBe("authentication_required");
    expect(apiError.status).toBe(401);
  });

  it("maps ResourceNotFoundError to a 404 resource_not_found error", () => {
    const apiError = toApiError(new ResourceNotFoundError());
    expect(apiError.code).toBe("resource_not_found");
    expect(apiError.status).toBe(404);
  });

  it("maps any other error to a generic 500 internal_error without leaking its message", () => {
    const apiError = toApiError(new TypeError("detalle interno sensible"));
    expect(apiError.code).toBe("internal_error");
    expect(apiError.status).toBe(500);
    expect(apiError.message).toBe("Ha ocurrido un error inesperado.");
  });
});

describe("apiErrorResponse", () => {
  beforeEach(() => {
    captureException.mockClear();
  });

  it("serializes the code, message, fields and request id", async () => {
    const error = new ApiError("validation_error", 400, "Revisa el campo.", {
      clientId: "Selecciona un cliente.",
    });
    const response = apiErrorResponse(error, "req-123");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "validation_error",
        message: "Revisa el campo.",
        fields: { clientId: "Selecciona un cliente." },
        requestId: "req-123",
      },
    });
  });

  it("reports 5xx errors to Sentry with the request id and error code", () => {
    const error = new ApiError("internal_error", 500, "Ha ocurrido un error.");
    apiErrorResponse(error, "req-500");

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error, {
      request_id: "req-500",
      error_code: "internal_error",
    });
  });

  it("never reports 4xx errors to Sentry", () => {
    const error = new ApiError("conflict", 409, "Ya existe.");
    apiErrorResponse(error, "req-409");

    expect(captureException).not.toHaveBeenCalled();
  });
});

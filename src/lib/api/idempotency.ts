import { ApiError } from "./errors";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;

export function parseIdempotencyKey(
  request: Request,
  required = false,
): string | undefined {
  const key = request.headers.get("Idempotency-Key")?.trim();

  if (!key && !required) {
    return undefined;
  }

  if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new ApiError(
      "idempotency_key_invalid",
      400,
      "La cabecera Idempotency-Key debe tener entre 16 y 256 caracteres seguros.",
    );
  }

  return key;
}

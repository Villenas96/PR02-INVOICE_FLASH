interface ErrorPayload {
  error?: {
    code?: string;
    message?: string;
  };
}

/** Preserves the stable `code` so callers can branch on specific API errors
 * (e.g. `overpayment_confirmation_required`) instead of parsing messages. */
export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

async function responseError(response: Response): Promise<ApiClientError> {
  let payload: ErrorPayload | undefined;
  try {
    payload = (await response.json()) as ErrorPayload;
  } catch {
    payload = undefined;
  }

  return new ApiClientError(
    payload?.error?.message ??
      "No se ha podido completar la acción. Inténtalo de nuevo.",
    payload?.error?.code,
  );
}

export async function apiRequest<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      Accept: "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw await responseError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function jsonRequest(method: "POST" | "PUT" | "PATCH", body: unknown) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  } satisfies RequestInit;
}

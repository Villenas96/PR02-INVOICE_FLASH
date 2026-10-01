interface ErrorPayload {
  error?: {
    code?: string;
    message?: string;
    fields?: Record<string, string>;
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

  const message =
    payload?.error?.message ??
    "No se ha podido completar la acción. Inténtalo de nuevo.";
  // Field messages say exactly what to fix (e.g. the client's address);
  // without them the user only sees the generic summary.
  const fieldMessages = [
    ...new Set(Object.values(payload?.error?.fields ?? {})),
  ];

  return new ApiClientError(
    [message, ...fieldMessages].join(" "),
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

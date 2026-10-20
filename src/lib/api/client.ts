import type { DocumentType, Feature, Plan } from "@/lib/plan";

interface ErrorPayload {
  error?: {
    code?: string;
    message?: string;
    fields?: Record<string, string>;
    details?: Record<string, unknown>;
  };
}

/** Preserves the stable `code` so callers can branch on specific API errors
 * (e.g. `overpayment_confirmation_required`) instead of parsing messages. */
export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** A plan restriction the UI must present as an upgrade invitation
 * (FR-009, FR-058), never as an error toast. */
export type Upsell =
  | {
      kind: "feature";
      message: string;
      feature: Feature;
      requiredPlan: Plan;
      upgradeUrl: string;
    }
  | {
      kind: "limit";
      message: string;
      plan: Plan;
      documentType: DocumentType;
      limit: number;
      used: number;
      upgradeUrl: string;
    };

export function upsellFromError(error: unknown): Upsell | null {
  if (!(error instanceof ApiClientError) || !error.details) {
    return null;
  }
  const details = error.details;
  const upgradeUrl =
    typeof details.upgrade_url === "string" ? details.upgrade_url : "/billing";

  if (
    error.code === "feature_not_in_plan" &&
    typeof details.feature === "string" &&
    typeof details.required_plan === "string"
  ) {
    return {
      kind: "feature",
      message: error.message,
      feature: details.feature as Feature,
      requiredPlan: details.required_plan as Plan,
      upgradeUrl,
    };
  }
  if (
    error.code === "plan_limit_reached" &&
    typeof details.document_type === "string" &&
    typeof details.limit === "number" &&
    typeof details.used === "number"
  ) {
    return {
      kind: "limit",
      message: error.message,
      plan: (typeof details.plan === "string" ? details.plan : "basic") as Plan,
      documentType: details.document_type as DocumentType,
      limit: details.limit,
      used: details.used,
      upgradeUrl,
    };
  }
  return null;
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
    payload?.error?.details,
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

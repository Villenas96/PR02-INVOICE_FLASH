import type { McpPrincipal } from "@/services/mcp/connections";
import { aiActor, attachMcpPrincipal } from "@/services/mcp/principal";

export interface ApiResult {
  status: number;
  body: unknown;
}

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;

/**
 * Runs an existing route handler in-process on behalf of the assistant. The
 * very same Zod schemas, company scoping and plan limits as the app apply,
 * because it IS the app's handler; only the identity differs.
 */
export async function callApi(input: {
  principal: McpPrincipal;
  handler: RouteHandler;
  method: "GET" | "POST" | "PATCH";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  params?: Record<string, string>;
  body?: unknown;
}): Promise<ApiResult> {
  const url = new URL(`http://mcp.internal${input.path}`);
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  const headers = new Headers({ "x-request-id": crypto.randomUUID() });
  if (input.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  const request = attachMcpPrincipal(
    new Request(url, {
      method: input.method,
      headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    }),
    {
      userId: input.principal.userId,
      companyId: input.principal.companyId,
      plan: input.principal.plan,
      actingAs: aiActor(input.principal.connectionId, input.principal.userId),
    },
  );
  const response = await input.handler(request, {
    params: Promise.resolve(input.params ?? {}),
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  return { status: response.status, body };
}

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { handleMcpRequest, type McpRateLimiter } from "@/services/mcp/server";
import {
  McpTokenError,
  mcpChallenge,
  verifyMcpAccessToken,
} from "@/services/mcp/token";

async function rateLimiter(): Promise<McpRateLimiter | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return (
      (env as { MCP_RATE_LIMITER?: McpRateLimiter }).MCP_RATE_LIMITER ?? null
    );
  } catch {
    return null;
  }
}

function unauthorized(error: McpTokenError): Response {
  const insufficient = error.kind === "insufficient_scope";
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32001, message: error.message },
      id: null,
    }),
    {
      status: insufficient ? 403 : 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": mcpChallenge(
          error.kind === "missing"
            ? undefined
            : insufficient
              ? "insufficient_scope"
              : "invalid_token",
        ),
      },
    },
  );
}

/** MCP over stateless Streamable HTTP: JSON-RPC requests arrive as POST. */
export async function POST(request: Request): Promise<Response> {
  let claims: Awaited<ReturnType<typeof verifyMcpAccessToken>>;
  try {
    claims = await verifyMcpAccessToken(request);
  } catch (error) {
    if (error instanceof McpTokenError) {
      return unauthorized(error);
    }
    throw error;
  }
  return handleMcpRequest(request, claims, {
    rateLimiter: await rateLimiter(),
    challenge: mcpChallenge("invalid_token"),
  });
}

function methodNotAllowed(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

// No server-initiated streams or sessions: nothing to GET or DELETE.
export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;

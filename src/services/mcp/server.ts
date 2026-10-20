import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { logSafe } from "@/lib/log";
import {
  McpAccessError,
  type McpPrincipal,
  resolveMcpPrincipal,
} from "@/services/mcp/connections";
import { registerTools } from "@/services/mcp/tools";

export interface McpRateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface AccessTokenClaims {
  sub?: unknown;
  azp?: unknown;
  client_id?: unknown;
}

function jsonRpcError(status: number, message: string, headers?: HeadersInit) {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32001, message },
      id: null,
    }),
    {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    },
  );
}

/**
 * One stateless MCP exchange (Streamable HTTP, JSON responses). The Bearer
 * token was already verified by the caller; everything that can change
 * between requests — connection revoked, company downgraded — is checked
 * here, on every request and with no cache (FR-054).
 */
export async function handleMcpRequest(
  request: Request,
  claims: AccessTokenClaims,
  dependencies: { rateLimiter?: McpRateLimiter | null; challenge: string },
): Promise<Response> {
  const userId = typeof claims.sub === "string" ? claims.sub : null;
  const clientId =
    typeof claims.azp === "string"
      ? claims.azp
      : typeof claims.client_id === "string"
        ? claims.client_id
        : null;
  if (!userId || !clientId) {
    return jsonRpcError(401, "Token no válido.", {
      "WWW-Authenticate": dependencies.challenge,
    });
  }

  let principal: McpPrincipal;
  try {
    principal = await resolveMcpPrincipal({ userId, oauthClientId: clientId });
  } catch (error) {
    if (error instanceof McpAccessError) {
      return error.reason === "plan_not_available"
        ? jsonRpcError(403, error.message)
        : jsonRpcError(401, error.message, {
            "WWW-Authenticate": dependencies.challenge,
          });
    }
    throw error;
  }

  if (dependencies.rateLimiter) {
    const { success } = await dependencies.rateLimiter.limit({
      key: principal.connectionId,
    });
    if (!success) {
      return jsonRpcError(
        429,
        "Demasiadas peticiones. Inténtalo de nuevo en un minuto.",
        { "Retry-After": "60" },
      );
    }
  }

  const server = new McpServer({ name: "factum", version: "1.0.0" });
  registerTools(server, principal);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } catch (error) {
    logSafe("error", "mcp.request_failed", {
      error_type: error instanceof Error ? error.name : "UnknownError",
    });
    return jsonRpcError(500, "Error interno del servidor.");
  } finally {
    await server.close();
  }
}

import { createLocalJWKSet, errors, type JSONWebKeySet, jwtVerify } from "jose";

import { getAuth, MCP_RESOURCE, MCP_SCOPE } from "@/lib/auth";

export class McpTokenError extends Error {
  constructor(
    public readonly kind: "missing" | "invalid" | "insufficient_scope",
  ) {
    super(
      kind === "insufficient_scope"
        ? "El token no incluye el permiso necesario."
        : "Token de acceso ausente o no válido.",
    );
    this.name = "McpTokenError";
  }
}

export interface McpTokenClaims {
  sub?: string;
  azp?: string;
  client_id?: string;
  scope?: string;
  [claim: string]: unknown;
}

/** `WWW-Authenticate` pointing MCP clients at the resource metadata (RFC 9728). */
export function mcpChallenge(error?: "invalid_token" | "insufficient_scope") {
  const metadata = `${new URL(MCP_RESOURCE).origin}/.well-known/oauth-protected-resource${new URL(MCP_RESOURCE).pathname}`;
  return `Bearer resource_metadata="${metadata}"${
    error ? `, error="${error}"` : ""
  }${error === "insufficient_scope" ? `, scope="${MCP_SCOPE}"` : ""}`;
}

/**
 * Verifies the Bearer access token locally: signature against the provider's
 * own signing keys (read from the database, no network round trip to ourselves),
 * issuer, audience (this MCP resource), expiry and scope.
 */
export async function verifyMcpAccessToken(
  request: Request,
): Promise<McpTokenClaims> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match?.[1]) {
    throw new McpTokenError("missing");
  }
  try {
    const auth = await getAuth();
    const context = await auth.$context;
    const keys = (await auth.api.getJwks()) as JSONWebKeySet;
    const { payload } = await jwtVerify(match[1], createLocalJWKSet(keys), {
      issuer: context.baseURL,
      audience: MCP_RESOURCE,
    });
    // Sender-constrained (DPoP) tokens are not issued here; never accept one
    // whose proof we would not check.
    if (payload.cnf !== undefined) {
      throw new McpTokenError("invalid");
    }
    const scopes =
      typeof payload.scope === "string" ? payload.scope.split(" ") : [];
    if (!scopes.includes(MCP_SCOPE)) {
      throw new McpTokenError("insufficient_scope");
    }
    return payload as McpTokenClaims;
  } catch (error) {
    if (error instanceof McpTokenError) {
      throw error;
    }
    if (error instanceof errors.JOSEError) {
      throw new McpTokenError("invalid");
    }
    throw error;
  }
}

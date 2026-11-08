import { auth } from "@/lib/auth";

/**
 * RFC 8414 discovery for MCP clients. The issuer is `<origin>/api/auth`, so
 * its metadata lives at `/.well-known/oauth-authorization-server/api/auth`
 * (path inserted after the well-known prefix), which is where MCP clients
 * such as Claude look. Served by the OAuth provider.
 */
export function GET(request: Request): Promise<Response> {
  return auth.handler(request);
}

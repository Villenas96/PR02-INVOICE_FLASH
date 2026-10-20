import { auth } from "@/lib/auth";

/** RFC 8414 discovery for MCP clients; served by the OAuth provider. */
export function GET(request: Request): Promise<Response> {
  return auth.handler(request);
}

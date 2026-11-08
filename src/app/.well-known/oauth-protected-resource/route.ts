import { auth } from "@/lib/auth";

/** RFC 9728 metadata of the MCP resource; served by the OAuth provider. */
export function GET(request: Request): Promise<Response> {
  return auth.handler(request);
}

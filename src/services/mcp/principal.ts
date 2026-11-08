import type { Plan } from "@/lib/plan";

/**
 * Identity of an AI assistant acting for a company owner (FR-054, FR-055).
 * The MCP endpoint attaches it to the in-process `Request` it builds for a
 * tool, so the very same route handlers (Zod schemas, company scoping, plan
 * limits, idempotency) serve both the app and the assistant.
 */
export interface McpRequestPrincipal {
  userId: string;
  companyId: string;
  plan: Plan;
  /** `ai:{connection}:user:{id}`, recorded as the actor of document events. */
  actingAs: string;
}

const principals = new WeakMap<Request, McpRequestPrincipal>();

export function attachMcpPrincipal(
  request: Request,
  principal: McpRequestPrincipal,
): Request {
  principals.set(request, principal);
  return request;
}

export function mcpPrincipalOf(request: Request): McpRequestPrincipal | null {
  return principals.get(request) ?? null;
}

export function aiActor(connectionId: string, userId: string): string {
  return `ai:${connectionId}:user:${userId}`;
}

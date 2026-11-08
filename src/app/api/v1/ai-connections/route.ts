import { z } from "zod";

import { runRoute } from "@/lib/api/route";
import { parseJson } from "@/lib/api/validate";
import { requireOwner, resolveCompanyContext } from "@/services/context";
import {
  aiConnectionResponse,
  createAiConnection,
  listAiConnections,
} from "@/services/mcp/connections";

const createSchema = z
  .object({ oauth_client_id: z.string().trim().min(1).max(256) })
  .strict();

/** Assistants connected to the company, owner only (FR-054). */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, "ai_connections.list_failed", async () => {
    // Owner-only data on a read route: advisors get read_only_access.
    const context = await resolveCompanyContext(request, { access: "read" });
    requireOwner(context);
    const items = await listAiConnections(context.companyId);
    return Response.json({ items: items.map(aiConnectionResponse) });
  });
}

/** Called by the consent page just before the user accepts (Pro only). */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, "ai_connections.create_failed", async () => {
    const context = await resolveCompanyContext(request, { access: "write" });
    const input = await parseJson(request, createSchema);
    const connection = await createAiConnection({
      context,
      oauthClientId: input.oauth_client_id,
    });
    return Response.json(aiConnectionResponse(connection), { status: 201 });
  });
}

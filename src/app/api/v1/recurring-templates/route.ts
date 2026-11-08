import { createDatabase } from "@/db";
import { parsePagination } from "@/lib/api/pagination";
import { runRoute } from "@/lib/api/route";
import { parseJson } from "@/lib/api/validate";
import { resolveCompanyContext } from "@/services/context";
import { requireFeature } from "@/services/entitlements";
import {
  createTemplate,
  createTemplateSchema,
  listTemplates,
} from "@/services/recurring/templates";

import { templateResponse } from "./serialize";

export async function GET(request: Request): Promise<Response> {
  return runRoute(request, "recurring.list_failed", async () => {
    const pagination = parsePagination(new URL(request.url).searchParams);
    const context = await resolveCompanyContext(request, { access: "read" });
    requireFeature(context, "recurring");
    const page = await listTemplates({
      database: createDatabase(),
      companyId: context.companyId,
      limit: pagination.limit,
      cursor: pagination.cursor,
    });
    return Response.json({
      items: page.items.map(templateResponse),
      next_cursor: page.nextCursor,
    });
  });
}

export async function POST(request: Request): Promise<Response> {
  return runRoute(request, "recurring.create_failed", async () => {
    const context = await resolveCompanyContext(request, { access: "write" });
    // The plan answers before the body is looked at.
    requireFeature(context, "recurring");
    const data = await parseJson(request, createTemplateSchema);
    const created = await createTemplate({ context, data });
    return Response.json(templateResponse(created), { status: 201 });
  });
}

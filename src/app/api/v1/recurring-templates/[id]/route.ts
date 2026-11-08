import { z } from "zod";

import { createDatabase } from "@/db";
import { runRoute } from "@/lib/api/route";
import { parseJson, validate } from "@/lib/api/validate";
import { resolveCompanyContext } from "@/services/context";
import { requireFeature } from "@/services/entitlements";
import {
  getTemplate,
  updateTemplate,
  updateTemplateSchema,
} from "@/services/recurring/templates";

import { templateResponse } from "../serialize";

const paramsSchema = z.object({ id: z.string().uuid() }).strict();
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, route: Params): Promise<Response> {
  return runRoute(request, "recurring.read_failed", async () => {
    const params = validate(paramsSchema, await route.params);
    const context = await resolveCompanyContext(request, { access: "read" });
    requireFeature(context, "recurring");
    return Response.json(
      templateResponse(
        await getTemplate(createDatabase(), context.companyId, params.id),
      ),
    );
  });
}

/** Content edits (new version, future cycles only) and status changes. */
export async function PATCH(
  request: Request,
  route: Params,
): Promise<Response> {
  return runRoute(request, "recurring.update_failed", async () => {
    const context = await resolveCompanyContext(request, { access: "write" });
    requireFeature(context, "recurring");
    const [params, data] = await Promise.all([
      route.params.then((value) => validate(paramsSchema, value)),
      parseJson(request, updateTemplateSchema),
    ]);
    const updated = await updateTemplate({
      context,
      templateId: params.id,
      data,
    });
    return Response.json(templateResponse(updated));
  });
}

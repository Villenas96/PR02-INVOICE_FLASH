import { z } from "zod";

import { runRoute } from "@/lib/api/route";
import { parseJson, validate } from "@/lib/api/validate";
import { getQueue } from "@/lib/cloudflare";
import { resolveCompanyContext } from "@/services/context";
import { confirmImport, confirmImportSchema } from "@/services/imports";

const paramsSchema = z.object({ id: z.string().uuid() }).strict();

/** `{mapping, duplicate_policy}` → `202`; only from `preview_ready`. */
export async function POST(
  request: Request,
  routeContext: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runRoute(request, "imports.confirm_failed", async () => {
    const params = validate(paramsSchema, await routeContext.params);
    const [context, input] = await Promise.all([
      resolveCompanyContext(request, { access: "write" }),
      parseJson(request, confirmImportSchema),
    ]);
    await confirmImport({
      queue: await getQueue("JOBS_QUEUE"),
      companyId: context.companyId,
      plan: context.plan,
      importId: params.id,
      mapping: input.mapping,
      duplicatePolicy: input.duplicate_policy,
    });
    return Response.json({ import_id: params.id }, { status: 202 });
  });
}

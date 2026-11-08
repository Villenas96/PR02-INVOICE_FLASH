import { z } from "zod";

import { runRoute } from "@/lib/api/route";
import { validate } from "@/lib/api/validate";
import { getAppBaseUrl, getDownloadTokenSecret } from "@/lib/env";
import { resolveCompanyContext } from "@/services/context";
import { getExport } from "@/services/exports";

import { exportResponse } from "../serialize";

const paramsSchema = z.object({ id: z.string().uuid() }).strict();

export async function GET(
  request: Request,
  routeContext: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runRoute(request, "exports.read_failed", async () => {
    const params = validate(paramsSchema, await routeContext.params);
    const context = await resolveCompanyContext(request, { access: "read" });
    const view = await getExport({
      companyId: context.companyId,
      exportId: params.id,
      appBaseUrl: getAppBaseUrl(),
      secret: getDownloadTokenSecret(),
    });
    return Response.json(exportResponse(view));
  });
}

import { z } from "zod";

import { createDatabase } from "@/db";
import { runRoute } from "@/lib/api/route";
import { validate } from "@/lib/api/validate";
import { resolveCompanyContext } from "@/services/context";
import { getImport } from "@/services/imports";

const paramsSchema = z.object({ id: z.string().uuid() }).strict();

export async function GET(
  request: Request,
  routeContext: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runRoute(request, "imports.read_failed", async () => {
    const params = validate(paramsSchema, await routeContext.params);
    const context = await resolveCompanyContext(request, { access: "read" });
    const job = await getImport(createDatabase(), context.companyId, params.id);
    return Response.json({
      id: job.id,
      kind: job.kind,
      status: job.status,
      error_code: job.errorCode,
      row_count: job.rowCount,
      mapping: job.mapping,
      duplicate_policy: job.duplicatePolicy,
      preview: job.preview,
      result: job.result,
      created_at: job.createdAt,
      updated_at: job.updatedAt,
    });
  });
}

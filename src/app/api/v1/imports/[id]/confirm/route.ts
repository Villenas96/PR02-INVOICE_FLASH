import { z } from "zod";

import { createDatabase } from "@/db";
import { runRoute } from "@/lib/api/route";
import { parseJson, validate } from "@/lib/api/validate";
import { getQueue } from "@/lib/cloudflare";
import {
  confirmBankImport,
  confirmBankImportSchema,
} from "@/services/bank/import";
import { resolveCompanyContext } from "@/services/context";
import {
  confirmImport,
  confirmImportSchema,
  getImport,
} from "@/services/imports";

const paramsSchema = z.object({ id: z.string().uuid() }).strict();

/**
 * Catalog: `{mapping, duplicate_policy}`. Bank statement: `{mapping?}` (CSV
 * only). `202`; only from `preview_ready`.
 */
export async function POST(
  request: Request,
  routeContext: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runRoute(request, "imports.confirm_failed", async () => {
    const params = validate(paramsSchema, await routeContext.params);
    const context = await resolveCompanyContext(request, { access: "write" });
    const database = createDatabase();
    const job = await getImport(database, context.companyId, params.id);
    const queue = await getQueue("JOBS_QUEUE");
    if (job.kind === "bank_statement") {
      const input = await parseJson(request, confirmBankImportSchema);
      await confirmBankImport({
        queue,
        companyId: context.companyId,
        plan: context.plan,
        job,
        mapping: input.mapping,
      });
    } else {
      const input = await parseJson(request, confirmImportSchema);
      await confirmImport({
        queue,
        companyId: context.companyId,
        plan: context.plan,
        importId: params.id,
        mapping: input.mapping,
        duplicatePolicy: input.duplicate_policy,
      });
    }
    return Response.json({ import_id: params.id }, { status: 202 });
  });
}

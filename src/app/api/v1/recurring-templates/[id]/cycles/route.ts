import { z } from "zod";

import { parsePagination } from "@/lib/api/pagination";
import { runRoute } from "@/lib/api/route";
import { validate } from "@/lib/api/validate";
import { resolveCompanyContext } from "@/services/context";
import { requireFeature } from "@/services/entitlements";
import { listCycles } from "@/services/recurring/templates";

const paramsSchema = z.object({ id: z.string().uuid() }).strict();

/** Cycles with their outcome and generated document (FR-040). */
export async function GET(
  request: Request,
  route: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runRoute(request, "recurring.cycles_failed", async () => {
    const params = validate(paramsSchema, await route.params);
    const pagination = parsePagination(new URL(request.url).searchParams);
    const context = await resolveCompanyContext(request, { access: "read" });
    requireFeature(context, "recurring");
    const page = await listCycles({
      companyId: context.companyId,
      templateId: params.id,
      limit: pagination.limit,
      cursor: pagination.cursor,
    });
    return Response.json({
      items: page.items.map((cycle) => ({
        id: cycle.id,
        cycle_index: cycle.cycleIndex,
        scheduled_on: cycle.scheduledOn,
        template_version: cycle.templateVersion,
        outcome: cycle.outcome,
        reason_code: cycle.reasonCode,
        document_id: cycle.documentId,
        document_number: cycle.documentNumber,
      })),
      next_cursor: page.nextCursor,
    });
  });
}

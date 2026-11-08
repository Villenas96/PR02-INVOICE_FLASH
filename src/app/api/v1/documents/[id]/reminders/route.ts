import { z } from "zod";

import { runRoute } from "@/lib/api/route";
import { validate } from "@/lib/api/validate";
import { resolveCompanyContext } from "@/services/context";
import { listDocumentReminders } from "@/services/reminders";

const paramsSchema = z.object({ id: z.string().uuid() }).strict();

/** Reminders sent or skipped for an invoice (FR-042). */
export async function GET(
  request: Request,
  route: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runRoute(request, "documents.reminders_failed", async () => {
    const params = validate(paramsSchema, await route.params);
    const context = await resolveCompanyContext(request, { access: "read" });
    const items = await listDocumentReminders({
      companyId: context.companyId,
      documentId: params.id,
    });
    return Response.json({
      items: items.map((item) => ({
        id: item.id,
        sequence: item.sequence,
        scheduled_on: item.scheduledOn,
        outcome: item.outcome,
      })),
    });
  });
}

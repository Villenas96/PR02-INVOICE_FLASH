import { z } from "zod";

import { runRoute } from "@/lib/api/route";
import { validate } from "@/lib/api/validate";
import { resolveCompanyContext } from "@/services/context";
import { markNotificationRead } from "@/services/notifications";

const paramsSchema = z.object({ id: z.string().uuid() }).strict();

/**
 * Read access is enough: an advisor may mark their own notices as read,
 * which only touches their own rows.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runRoute(request, "notifications.read_failed", async () => {
    const params = validate(paramsSchema, await context.params);
    const company = await resolveCompanyContext(request, { access: "read" });
    await markNotificationRead({
      userId: company.userId,
      notificationId: params.id,
    });
    return new Response(null, { status: 204 });
  });
}

import { z } from "zod";

import { parsePagination } from "@/lib/api/pagination";
import { runRoute } from "@/lib/api/route";
import { validate } from "@/lib/api/validate";
import { resolveCompanyContext } from "@/services/context";
import { listNotifications } from "@/services/notifications";

const querySchema = z
  .object({
    unread: z.enum(["true", "false"]).optional(),
    limit: z.string().optional(),
    cursor: z.string().optional(),
  })
  .strict();

/** The signed-in user's notices for the active company (R21). */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, "notifications.list_failed", async () => {
    const searchParams = new URL(request.url).searchParams;
    const query = validate(querySchema, Object.fromEntries(searchParams));
    const pagination = parsePagination(searchParams);
    const context = await resolveCompanyContext(request, { access: "read" });
    const page = await listNotifications({
      userId: context.userId,
      companyId: context.companyId,
      unreadOnly: query.unread === "true",
      limit: pagination.limit,
      cursor: pagination.cursor,
    });
    return Response.json({
      data: page.items.map((item) => ({
        id: item.id,
        kind: item.kind,
        title: item.title,
        body: item.body,
        href: item.href,
        read_at: item.readAt,
        created_at: item.createdAt,
      })),
      next_cursor: page.nextCursor,
      unread_count: page.unreadCount,
    });
  });
}

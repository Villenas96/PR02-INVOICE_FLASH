import { z } from "zod";

import { parsePagination } from "@/lib/api/pagination";
import { runRoute } from "@/lib/api/route";
import { parseJson } from "@/lib/api/validate";
import { getQueue } from "@/lib/cloudflare";
import { getDownloadTokenSecret } from "@/lib/env";
import {
  inviteAdvisor,
  listAccessEvents,
  listAdvisorAccess,
} from "@/services/advisor-access";
import { resolveCompanyContext } from "@/services/context";

const inviteSchema = z
  .object({
    email: z
      .string()
      .trim()
      .max(320)
      .email("Introduce un correo electrónico válido."),
  })
  .strict();

/** Accesses and the advisor activity log, visible to the owner (FR-053). */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, "advisor_access.list_failed", async () => {
    const pagination = parsePagination(new URL(request.url).searchParams);
    // Owner-only data on a read route: advisors get read_only_access below.
    const context = await resolveCompanyContext(request, { access: "read" });
    const [accesses, events] = await Promise.all([
      listAdvisorAccess({ context }),
      listAccessEvents({
        context,
        limit: pagination.limit,
        cursor: pagination.cursor,
      }),
    ]);
    return Response.json({
      accesses: accesses.map((access) => ({
        id: access.id,
        status: access.status,
        email: access.email,
        invited_at: access.invitedAt,
        accepted_at: access.acceptedAt,
        revoked_at: access.revokedAt,
        expires_at: access.expiresAt,
        last_access_at: access.lastAccessAt,
      })),
      events: events.items.map((event) => ({
        id: event.id,
        action: event.action,
        actor_email: event.actorEmail,
        target_id: event.targetId,
        created_at: event.createdAt,
      })),
      next_cursor: events.nextCursor,
    });
  });
}

/** `{email}` → invitation that expires in 7 days (FR-050). */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, "advisor_access.invite_failed", async () => {
    const [context, input] = await Promise.all([
      resolveCompanyContext(request, { access: "write" }),
      parseJson(request, inviteSchema),
    ]);
    const invitation = await inviteAdvisor({
      emailQueue: await getQueue("EMAIL_SEND_QUEUE"),
      context,
      email: input.email,
      secret: getDownloadTokenSecret(),
    });
    return Response.json(
      { id: invitation.id, expires_at: invitation.expiresAt },
      { status: 201 },
    );
  });
}

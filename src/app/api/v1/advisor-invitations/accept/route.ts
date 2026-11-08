import { z } from "zod";

import { runRoute } from "@/lib/api/route";
import { parseJson } from "@/lib/api/validate";
import { getDownloadTokenSecret } from "@/lib/env";
import { acceptInvitation } from "@/services/advisor-access";
import { requireSession } from "@/services/context";

const acceptSchema = z.object({ token: z.string().min(1).max(200) }).strict();

/** Links the signed-in account to the inviting company (FR-050). */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, "advisor_invitations.accept_failed", async () => {
    const [session, input] = await Promise.all([
      requireSession(request),
      parseJson(request, acceptSchema),
    ]);
    const accepted = await acceptInvitation({
      token: input.token,
      secret: getDownloadTokenSecret(),
      userId: session.userId,
      userEmail: session.email,
      sessionId: session.sessionId,
    });
    return Response.json({ company_id: accepted.companyId });
  });
}

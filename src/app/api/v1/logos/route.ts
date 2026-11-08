import { z } from "zod";

import { runRoute } from "@/lib/api/route";
import { validate } from "@/lib/api/validate";
import { getPrivateBucket } from "@/lib/storage-binding";
import {
  ResourceNotFoundError,
  resolveCompanyContext,
} from "@/services/context";
import { isCompanyLogoKey } from "@/services/logos";

const querySchema = z.object({ key: z.string().min(1).max(300) }).strict();

/**
 * Serves a logo of the active company to the app (settings, client detail,
 * printable view). Keys of other companies are a generic 404.
 */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, "logos.read_failed", async () => {
    const context = await resolveCompanyContext(request, { access: "read" });
    const query = validate(
      querySchema,
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!isCompanyLogoKey(context.companyId, query.key)) {
      throw new ResourceNotFoundError();
    }
    const object = await (await getPrivateBucket()).get(query.key);
    if (!object) {
      throw new ResourceNotFoundError();
    }
    return new Response(object.body, {
      headers: {
        "Content-Type": object.httpMetadata?.contentType ?? "image/png",
        // Content-addressed keys never change: safe to cache privately.
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

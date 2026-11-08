import { z } from "zod";

import { runRoute } from "@/lib/api/route";
import { validate } from "@/lib/api/validate";
import { getPrivateBucket } from "@/lib/storage-binding";
import { ResourceNotFoundError } from "@/services/context";
import { resolveSharedDocument } from "@/services/shared-document";

const paramsSchema = z
  .object({
    token: z.string().min(1).max(200),
    party: z.enum(["issuer", "client"]),
  })
  .strict();

/**
 * Logo frozen in the snapshot of a publicly shared document. Only the two
 * keys of that document can be reached through its token, never any other
 * object of the bucket.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ token: string; party: string }> },
): Promise<Response> {
  return runRoute(request, "public.logo_failed", async () => {
    const params = validate(paramsSchema, await context.params);
    const shared = await resolveSharedDocument(params.token);
    const key =
      params.party === "issuer" ? shared?.issuerLogoKey : shared?.clientLogoKey;
    if (!key) {
      throw new ResourceNotFoundError();
    }
    const object = await (await getPrivateBucket()).get(key);
    if (!object) {
      throw new ResourceNotFoundError();
    }
    return new Response(object.body, {
      headers: {
        "Content-Type": object.httpMetadata?.contentType ?? "image/png",
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  });
}

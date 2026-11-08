import { z } from "zod";

import { createDatabase } from "@/db";
import { runRoute } from "@/lib/api/route";
import { parseJson, validate } from "@/lib/api/validate";
import {
  collectionMethodPatchSchema,
  collectionMethodResponse,
  updateCollectionMethod,
} from "@/services/collection-methods";
import { resolveCompanyContext } from "@/services/context";

const paramsSchema = z.object({ id: z.string().uuid() }).strict();

export async function PATCH(
  request: Request,
  routeContext: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runRoute(request, "collection_methods.update_failed", async () => {
    const [context, params, input] = await Promise.all([
      resolveCompanyContext(request, { access: "write" }),
      routeContext.params.then((value) => validate(paramsSchema, value)),
      parseJson(request, collectionMethodPatchSchema),
    ]);
    const method = await updateCollectionMethod(
      createDatabase(),
      context.companyId,
      params.id,
      input,
    );
    return Response.json(collectionMethodResponse(method));
  });
}

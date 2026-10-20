import { z } from "zod";

import { createDatabase } from "@/db";
import { runRoute } from "@/lib/api/route";
import { parseJson, validate } from "@/lib/api/validate";
import {
  collectionMethodInputSchema,
  collectionMethodResponse,
  createCollectionMethod,
  listCollectionMethods,
} from "@/services/collection-methods";
import { resolveCompanyContext } from "@/services/context";

const listQuerySchema = z
  .object({ archived: z.enum(["true", "false"]).optional() })
  .strict();

export async function GET(request: Request): Promise<Response> {
  return runRoute(request, "collection_methods.list_failed", async () => {
    const query = validate(
      listQuerySchema,
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    const context = await resolveCompanyContext(request, { access: "read" });
    const methods = await listCollectionMethods(
      createDatabase(),
      context.companyId,
      query.archived === undefined ? undefined : query.archived === "true",
    );
    return Response.json({
      items: methods.map(collectionMethodResponse),
      next_cursor: null,
    });
  });
}

export async function POST(request: Request): Promise<Response> {
  return runRoute(request, "collection_methods.create_failed", async () => {
    const [context, input] = await Promise.all([
      resolveCompanyContext(request, { access: "write" }),
      parseJson(request, collectionMethodInputSchema),
    ]);
    const method = await createCollectionMethod(
      createDatabase(),
      context.companyId,
      input,
    );
    return Response.json(collectionMethodResponse(method), { status: 201 });
  });
}

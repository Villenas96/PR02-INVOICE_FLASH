import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { createDatabase } from "@/db/index";
import { clients } from "@/db/schema/client";
import { runRoute } from "@/lib/api/route";
import { validate } from "@/lib/api/validate";
import { getPrivateBucket } from "@/lib/storage-binding";
import {
  ResourceNotFoundError,
  resolveCompanyContext,
} from "@/services/context";
import {
  assertLogoRequestSize,
  logoFileFrom,
  storeLogo,
  validateLogoFile,
} from "@/services/logos";

const paramsSchema = z.object({ id: z.string().uuid() }).strict();

async function setClientLogo(
  companyId: string,
  clientId: string,
  logoKey: string | null,
): Promise<void> {
  const [updated] = await createDatabase()
    .update(clients)
    .set({ logoKey, updatedAt: new Date() })
    .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId)))
    .returning({ id: clients.id });
  if (!updated) {
    throw new ResourceNotFoundError();
  }
}

/** Client logo (FR-025), frozen into the client snapshot at issue. */
export async function PUT(
  request: Request,
  routeContext: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runRoute(request, "client.logo_failed", async () => {
    assertLogoRequestSize(request);
    const [context, params] = await Promise.all([
      resolveCompanyContext(request, { access: "write" }),
      routeContext.params.then((value) => validate(paramsSchema, value)),
    ]);
    const logo = await validateLogoFile(await logoFileFrom(request));
    const key = await storeLogo(
      await getPrivateBucket(),
      context.companyId,
      logo,
    );
    await setClientLogo(context.companyId, params.id, key);
    return Response.json({ logo_key: key });
  });
}

export async function DELETE(
  request: Request,
  routeContext: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runRoute(request, "client.logo_failed", async () => {
    const [context, params] = await Promise.all([
      resolveCompanyContext(request, { access: "write" }),
      routeContext.params.then((value) => validate(paramsSchema, value)),
    ]);
    await setClientLogo(context.companyId, params.id, null);
    return new Response(null, { status: 204 });
  });
}

import { and, eq } from "drizzle-orm";

import { createDatabase } from "@/db/index";
import { companies } from "@/db/schema/company";
import { runRoute } from "@/lib/api/route";
import { logSafe } from "@/lib/log";
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

/**
 * Company logo (FR-024). Previous images are never deleted here: issued
 * documents may reference them in their frozen snapshot; the daily purge
 * removes logos nothing references any more.
 */
export async function PUT(request: Request): Promise<Response> {
  return runRoute(request, "company.logo_failed", async () => {
    assertLogoRequestSize(request);
    const context = await resolveCompanyContext(request, { access: "write" });
    const logo = await validateLogoFile(await logoFileFrom(request));
    const key = await storeLogo(
      await getPrivateBucket(),
      context.companyId,
      logo,
    );
    const [updated] = await createDatabase()
      .update(companies)
      .set({ logoKey: key, updatedAt: new Date() })
      .where(
        and(
          eq(companies.id, context.companyId),
          eq(companies.userId, context.userId),
        ),
      )
      .returning({ id: companies.id });
    if (!updated) {
      throw new ResourceNotFoundError();
    }
    logSafe("info", "company.logo_uploaded", {
      content_type: logo.contentType,
      byte_length: logo.bytes.byteLength,
    });
    return Response.json({ logo_key: key });
  });
}

export async function DELETE(request: Request): Promise<Response> {
  return runRoute(request, "company.logo_failed", async () => {
    const context = await resolveCompanyContext(request, { access: "write" });
    await createDatabase()
      .update(companies)
      .set({ logoKey: null, updatedAt: new Date() })
      .where(
        and(
          eq(companies.id, context.companyId),
          eq(companies.userId, context.userId),
        ),
      );
    return new Response(null, { status: 204 });
  });
}

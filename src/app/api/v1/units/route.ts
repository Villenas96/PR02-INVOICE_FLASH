import { z } from "zod";

import { createDatabase } from "@/db";
import { runRoute } from "@/lib/api/route";
import { parseJson } from "@/lib/api/validate";
import { resolveCompanyContext } from "@/services/context";
import { createUnit, listUnits } from "@/services/units";

const createSchema = z.object({ name: z.string() }).strict();

export async function GET(request: Request): Promise<Response> {
  return runRoute(request, "units.list_failed", async () => {
    const context = await resolveCompanyContext(request, { access: "read" });
    return Response.json(await listUnits(createDatabase(), context.companyId));
  });
}

export async function POST(request: Request): Promise<Response> {
  return runRoute(request, "units.create_failed", async () => {
    const [context, input] = await Promise.all([
      resolveCompanyContext(request, { access: "write" }),
      parseJson(request, createSchema),
    ]);
    const unit = await createUnit(
      createDatabase(),
      context.companyId,
      input.name,
    );
    return Response.json(
      { id: unit.id, name: unit.name },
      { status: unit.created ? 201 : 200 },
    );
  });
}

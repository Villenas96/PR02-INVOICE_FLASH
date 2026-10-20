import { z } from "zod";

import { parsePagination } from "@/lib/api/pagination";
import { runRoute } from "@/lib/api/route";
import { parseJson, validate } from "@/lib/api/validate";
import { getQueue } from "@/lib/cloudflare";
import { getAppBaseUrl, getDownloadTokenSecret } from "@/lib/env";
import { resolveCompanyContext } from "@/services/context";
import {
  createExport,
  createExportSchema,
  listExports,
} from "@/services/exports";

import { exportResponse } from "./serialize";

const listQuerySchema = z
  .object({ limit: z.string().optional(), cursor: z.string().optional() })
  .strict();

/** Read access: advisors may export too (FR-051). */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, "exports.create_failed", async () => {
    const [context, input] = await Promise.all([
      resolveCompanyContext(request, { access: "read" }),
      parseJson(request, createExportSchema),
    ]);
    const created = await createExport({
      queue: await getQueue("JOBS_QUEUE"),
      context,
      request: input,
    });
    return Response.json({ export_id: created.id }, { status: 202 });
  });
}

/** Export and advisor-send history (FR-032). */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, "exports.list_failed", async () => {
    const searchParams = new URL(request.url).searchParams;
    validate(listQuerySchema, Object.fromEntries(searchParams));
    const pagination = parsePagination(searchParams);
    const context = await resolveCompanyContext(request, { access: "read" });
    const page = await listExports({
      companyId: context.companyId,
      limit: pagination.limit,
      cursor: pagination.cursor,
      appBaseUrl: getAppBaseUrl(),
      secret: getDownloadTokenSecret(),
    });
    return Response.json({
      items: page.items.map(exportResponse),
      next_cursor: page.nextCursor,
    });
  });
}

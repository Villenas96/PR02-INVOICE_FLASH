import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, eq, gt } from "drizzle-orm";

import { createDatabase } from "@/db";
import { exportJobs } from "@/db/schema/export-job";
import { ApiError, apiErrorResponse } from "@/lib/api/errors";
import {
  hashDownloadToken,
  isSignedDownloadToken,
} from "@/lib/download-tokens";
import { getDownloadTokenSecret } from "@/lib/env";
import { exportFilesSchema } from "@/lib/exports/files";
import { logSafe } from "@/lib/log";
import { getPrivateBucket } from "@/lib/storage-binding";

interface RateLimiterBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

function notFound(): Response {
  return apiErrorResponse(
    new ApiError(
      "resource_not_found",
      404,
      "No se ha encontrado el recurso solicitado.",
    ),
  );
}

/** `EXPORT_RATE_LIMITER` only exists in the deployed Worker; best-effort. */
async function isRateLimited(request: Request): Promise<boolean> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const limiter = (env as { EXPORT_RATE_LIMITER?: RateLimiterBinding })
      .EXPORT_RATE_LIMITER;
    if (!limiter) {
      return false;
    }
    const ip =
      request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";
    const { success } = await limiter.limit({ key: ip });
    return !success;
  } catch {
    return false;
  }
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Public download of an export (research R12). Any invalid, unknown,
 * expired or not-ready token is the same generic 404; the token is never
 * logged.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  if (await isRateLimited(request)) {
    logSafe("warn", "public.export_rate_limited", {});
    return apiErrorResponse(
      // Same code as the public share limiter (src/proxies/middleware.ts).
      new ApiError(
        "validation_error",
        429,
        "Demasiadas solicitudes. Inténtalo de nuevo en un momento.",
      ),
    );
  }

  try {
    const { token } = await context.params;
    if (!(await isSignedDownloadToken(getDownloadTokenSecret(), token))) {
      return notFound();
    }
    const fileIndex = Number(new URL(request.url).searchParams.get("f") ?? 0);
    const [job] = await createDatabase()
      .select({ fileKeys: exportJobs.fileKeys })
      .from(exportJobs)
      .where(
        and(
          eq(exportJobs.downloadTokenHash, await hashDownloadToken(token)),
          eq(exportJobs.status, "ready"),
          gt(exportJobs.expiresAt, new Date()),
        ),
      )
      .limit(1);
    const files = job ? exportFilesSchema.safeParse(job.fileKeys) : null;
    const file =
      files?.success && Number.isInteger(fileIndex)
        ? files.data[fileIndex]
        : undefined;
    if (!file) {
      return notFound();
    }
    const object = await (await getPrivateBucket()).get(file.key);
    if (!object) {
      return notFound();
    }
    return new Response(object.body, {
      headers: {
        "Content-Type": file.content_type,
        "Content-Disposition": contentDisposition(file.filename),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    logSafe("error", "public.export_download_failed", {
      error_type: error instanceof Error ? error.name : "UnknownError",
    });
    return apiErrorResponse(
      new ApiError(
        "internal_error",
        500,
        "No se ha podido descargar el archivo en este momento.",
      ),
    );
  }
}

import { ApiError } from "@/lib/api/errors";
import { runRoute } from "@/lib/api/route";
import { getQueue } from "@/lib/cloudflare";
import { MAX_IMPORT_BYTES } from "@/lib/csv/detect";
import { getPrivateBucket } from "@/lib/storage-binding";
import { resolveCompanyContext } from "@/services/context";
import { requireFeature } from "@/services/entitlements";
import { createCatalogImport, importTooLargeError } from "@/services/imports";

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

function validationError(message: string, field: string): ApiError {
  return new ApiError("validation_error", 400, message, { [field]: message });
}

/**
 * `multipart {kind, file}` → `202 {import_id}` (FR-031). The file is only
 * stored and queued for analysis here.
 */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, "imports.create_failed", async () => {
    const context = await resolveCompanyContext(request, { access: "write" });
    // Before reading the body: a Basic/Essential upload is never stored.
    requireFeature(context, "catalog_import");
    const contentLength = Number(request.headers.get("content-length") ?? "");
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_IMPORT_BYTES + MULTIPART_OVERHEAD_BYTES
    ) {
      throw importTooLargeError();
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw validationError(
        "Envía el archivo como formulario multipart válido.",
        "file",
      );
    }
    const kind = form.get("kind");
    const file = form.get("file");
    if (kind !== "catalog") {
      // `bank_statement` arrives with bank reconciliation (US12).
      throw validationError("Tipo de importación no admitido.", "kind");
    }
    if (!(file instanceof File) || file.size === 0) {
      throw validationError("Adjunta un archivo CSV.", "file");
    }
    const created = await createCatalogImport({
      bucket: await getPrivateBucket(),
      queue: await getQueue("JOBS_QUEUE"),
      companyId: context.companyId,
      plan: context.plan,
      file,
    });
    return Response.json({ import_id: created.id }, { status: 202 });
  });
}

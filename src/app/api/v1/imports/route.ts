import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { runRoute } from "@/lib/api/route";
import { getQueue } from "@/lib/cloudflare";
import { MAX_IMPORT_BYTES } from "@/lib/csv/detect";
import { getPrivateBucket } from "@/lib/storage-binding";
import { createBankImport } from "@/services/bank/import";
import { resolveCompanyContext } from "@/services/context";
import { requireFeature } from "@/services/entitlements";
import { createCatalogImport, importTooLargeError } from "@/services/imports";

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

function methodIdFrom(value: FormDataEntryValue | null): string {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) {
    throw validationError(
      "Elige la cuenta bancaria del extracto.",
      "collection_method_id",
    );
  }
  return parsed.data;
}

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
    if (kind !== "catalog" && kind !== "bank_statement") {
      throw validationError("Tipo de importación no admitido.", "kind");
    }
    // The plan answers before anything is stored.
    requireFeature(
      context,
      kind === "catalog" ? "catalog_import" : "bank_reconciliation",
    );
    if (!(file instanceof File) || file.size === 0) {
      throw validationError("Adjunta un archivo.", "file");
    }
    const bucket = await getPrivateBucket();
    const queue = await getQueue("JOBS_QUEUE");
    const created =
      kind === "catalog"
        ? await createCatalogImport({
            bucket,
            queue,
            companyId: context.companyId,
            plan: context.plan,
            file,
          })
        : await createBankImport({
            bucket,
            queue,
            companyId: context.companyId,
            plan: context.plan,
            file,
            collectionMethodId: methodIdFrom(form.get("collection_method_id")),
          });
    return Response.json({ import_id: created.id }, { status: 202 });
  });
}

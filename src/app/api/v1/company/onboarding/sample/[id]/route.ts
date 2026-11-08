import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { runRoute } from "@/lib/api/route";
import { validate } from "@/lib/api/validate";
import { getPrivateBucket } from "@/lib/storage-binding";
import { resolveCompanyContext } from "@/services/context";
import { getSample } from "@/services/onboarding";

const paramsSchema = z.object({ id: z.string().uuid() }).strict();

/** The sample PDF once ready; `202` while it renders. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runRoute(request, "onboarding.sample_read_failed", async () => {
    const { id } = validate(paramsSchema, await params);
    const context = await resolveCompanyContext(request, { access: "read" });
    const sample = await getSample(context, id);
    if (sample.status === "failed") {
      throw new ApiError(
        "pdf_generation_failed",
        409,
        "No se ha podido generar el ejemplo. Inténtalo de nuevo.",
      );
    }
    if (sample.status !== "ready" || !sample.fileKey) {
      return Response.json(
        { error: { code: "pdf_processing", message: "Generando el ejemplo…" } },
        { status: 202, headers: { "Retry-After": "2" } },
      );
    }
    const object = await (await getPrivateBucket()).get(sample.fileKey);
    if (!object) {
      throw new ApiError(
        "pdf_generation_failed",
        409,
        "El ejemplo ha caducado. Genera uno nuevo.",
      );
    }
    return new Response(object.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="ejemplo.pdf"',
        "Cache-Control": "private, no-store",
      },
    });
  });
}

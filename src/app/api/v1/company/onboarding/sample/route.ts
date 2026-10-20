import { runRoute } from "@/lib/api/route";
import { getQueue } from "@/lib/cloudflare";
import { resolveCompanyContext } from "@/services/context";
import { requestSample } from "@/services/onboarding";

/** Queues the watermarked sample; never creates a document (FR-049). */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, "onboarding.sample_failed", async () => {
    const context = await resolveCompanyContext(request, { access: "write" });
    const { sampleId } = await requestSample({
      context,
      queue: await getQueue("JOBS_QUEUE"),
    });
    return Response.json({ sample_id: sampleId }, { status: 202 });
  });
}

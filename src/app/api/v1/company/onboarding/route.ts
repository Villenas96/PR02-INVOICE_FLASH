import { runRoute } from "@/lib/api/route";
import { parseJson } from "@/lib/api/validate";
import { onboardingUpdateSchema } from "@/lib/onboarding";
import { resolveCompanyContext } from "@/services/context";
import { getOnboarding, updateOnboarding } from "@/services/onboarding";

export async function GET(request: Request): Promise<Response> {
  return runRoute(request, "onboarding.read_failed", async () => {
    const context = await resolveCompanyContext(request, { access: "read" });
    return Response.json(await getOnboarding(context));
  });
}

/** Records a wizard action: complete, skip or dismiss (FR-048). */
export async function PATCH(request: Request): Promise<Response> {
  return runRoute(request, "onboarding.update_failed", async () => {
    const context = await resolveCompanyContext(request, { access: "write" });
    const update = await parseJson(request, onboardingUpdateSchema);
    return Response.json(await updateOnboarding(context, update));
  });
}

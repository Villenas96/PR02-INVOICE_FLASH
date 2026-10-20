import { runRoute } from "@/lib/api/route";
import { parseJson } from "@/lib/api/validate";
import {
  advisorScheduleSchema,
  getAdvisorSchedule,
  saveAdvisorSchedule,
} from "@/services/advisor-schedule";
import { resolveCompanyContext } from "@/services/context";

type Schedule = Awaited<ReturnType<typeof getAdvisorSchedule>>;

function scheduleResponse(schedule: Schedule) {
  return schedule
    ? {
        frequency: schedule.frequency,
        formats: schedule.formats,
        enabled: schedule.enabled,
        last_period_key: schedule.lastPeriodKey,
      }
    : {
        frequency: "quarterly",
        formats: ["xlsx"],
        enabled: false,
        last_period_key: null,
      };
}

export async function GET(request: Request): Promise<Response> {
  return runRoute(request, "advisor_schedule.read_failed", async () => {
    const context = await resolveCompanyContext(request, { access: "read" });
    return Response.json(scheduleResponse(await getAdvisorSchedule(context)));
  });
}

export async function PUT(request: Request): Promise<Response> {
  return runRoute(request, "advisor_schedule.save_failed", async () => {
    const [context, input] = await Promise.all([
      resolveCompanyContext(request, { access: "write" }),
      parseJson(request, advisorScheduleSchema),
    ]);
    return Response.json(
      scheduleResponse((await saveAdvisorSchedule(context, input)) ?? null),
    );
  });
}

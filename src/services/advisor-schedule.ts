import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { createDatabase, type Database } from "@/db";
import { advisorSchedules } from "@/db/schema/advisor-schedule";
import { companies } from "@/db/schema/company";
import { ApiError } from "@/lib/api/errors";
import { closedPeriodOn } from "@/lib/exports/period";
import { hasFeature, normalizePlan } from "@/lib/plan";
import { type CompanyContext, requireOwner } from "@/services/context";
import { requireFeature } from "@/services/entitlements";
import { createScheduledExport, type JobsQueue } from "@/services/exports";

export const advisorScheduleSchema = z
  .object({
    frequency: z.enum(["monthly", "quarterly"]),
    formats: z
      .array(z.enum(["xlsx", "pdf_zip"]))
      .min(1)
      .max(2),
    enabled: z.boolean(),
  })
  .strict();
export type AdvisorScheduleInput = z.infer<typeof advisorScheduleSchema>;

export async function getAdvisorSchedule(
  context: CompanyContext,
  database: Database = createDatabase(),
) {
  requireOwner(context);
  const [schedule] = await database
    .select()
    .from(advisorSchedules)
    .where(eq(advisorSchedules.companyId, context.companyId));
  return schedule ?? null;
}

/** FR-034: needs Pro and the advisor email to send to. */
export async function saveAdvisorSchedule(
  context: CompanyContext,
  input: AdvisorScheduleInput,
  database: Database = createDatabase(),
  now = new Date(),
) {
  requireOwner(context);
  requireFeature(context, "advisor_schedule");
  if (input.enabled) {
    const [company] = await database
      .select({ advisorEmail: companies.advisorEmail })
      .from(companies)
      .where(eq(companies.id, context.companyId));
    if (!company?.advisorEmail) {
      throw new ApiError(
        "validation_error",
        400,
        "Indica primero el email de tu asesoría.",
        { advisor_email: "Falta el email de tu asesoría." },
      );
    }
  }
  const values = {
    frequency: input.frequency,
    formats: input.formats,
    enabled: input.enabled,
    updatedAt: now,
  };
  const [saved] = await database
    .insert(advisorSchedules)
    .values({ companyId: context.companyId, ...values, createdAt: now })
    .onConflictDoUpdate({ target: advisorSchedules.companyId, set: values })
    .returning();
  return saved;
}

/**
 * Planner step (FR-034): on the first day after a month or quarter closes,
 * one system export per company and period (unique `(company_id,
 * period_key)`), only while the company is Pro and has an advisor email.
 */
export async function planAdvisorExports(dependencies: {
  database?: Database;
  queue: JobsQueue;
  now?: Date;
}): Promise<number> {
  const database = dependencies.database ?? createDatabase();
  const now = dependencies.now ?? new Date();
  const due = await database
    .select({
      companyId: advisorSchedules.companyId,
      frequency: advisorSchedules.frequency,
      formats: advisorSchedules.formats,
      plan: companies.plan,
    })
    .from(advisorSchedules)
    .innerJoin(companies, eq(companies.id, advisorSchedules.companyId))
    .where(
      and(
        eq(advisorSchedules.enabled, true),
        isNotNull(companies.advisorEmail),
      ),
    );
  let planned = 0;
  for (const schedule of due) {
    if (!hasFeature(normalizePlan(schedule.plan), "advisor_schedule")) {
      continue;
    }
    const period = closedPeriodOn(schedule.frequency, now);
    if (!period) {
      continue;
    }
    const created = await createScheduledExport({
      database,
      queue: dependencies.queue,
      companyId: schedule.companyId,
      period,
      formats: schedule.formats as Array<"xlsx" | "pdf_zip">,
      now,
    });
    if (created) {
      planned += 1;
      await database
        .update(advisorSchedules)
        .set({ lastPeriodKey: period.key, updatedAt: now })
        .where(eq(advisorSchedules.companyId, schedule.companyId));
    }
  }
  return planned;
}

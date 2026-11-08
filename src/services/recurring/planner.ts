import { and, desc, eq, isNotNull, lte } from "drizzle-orm";

import { createDatabase, type Database } from "@/db";
import { companies } from "@/db/schema/company";
import { planChanges } from "@/db/schema/plan-change";
import { recurringCycles } from "@/db/schema/recurring-cycle";
import { recurringTemplates } from "@/db/schema/recurring-template";
import { createUuidV7 } from "@/lib/ids";
import { hasFeature, madridDate } from "@/lib/plan";
import { pendingCycles } from "@/lib/recurrence";
import { createNotification } from "@/services/notifications";
import { createRecurringRunMessage } from "@/workers/messages";

import { generatedCycles, ruleOf } from "./templates";

interface JobsQueue {
  send(message: unknown): Promise<void>;
}

/**
 * Planner step (research R11, SC-008): claims every due cycle with the
 * unique `(template_id, cycle_index)` row and enqueues one `recurring.run`
 * per pending cycle. It never creates documents itself. Re-running it, or
 * running it after an outage, claims each cycle at most once and recovers
 * the missed ones.
 */
export async function planRecurringCycles(dependencies: {
  database?: Database;
  queue: JobsQueue;
  now?: Date;
}): Promise<number> {
  const database = dependencies.database ?? createDatabase();
  const now = dependencies.now ?? new Date();
  const today = madridDate(now);

  const due = await database
    .select({ template: recurringTemplates, plan: companies.plan })
    .from(recurringTemplates)
    .innerJoin(companies, eq(companies.id, recurringTemplates.companyId))
    .where(
      and(
        eq(recurringTemplates.status, "active"),
        isNotNull(recurringTemplates.nextRunOn),
        lte(recurringTemplates.nextRunOn, today),
      ),
    );

  let enqueued = 0;
  for (const { template, plan } of due) {
    const rule = ruleOf(template);
    const entitled = hasFeature(plan, "recurring");
    let generated = await generatedCycles(database, template.id);
    let skipped = 0;

    for (const cycle of pendingCycles(rule, generated, today)) {
      const [claimed] = await database
        .insert(recurringCycles)
        .values({
          id: createUuidV7(now.getTime()),
          companyId: template.companyId,
          templateId: template.id,
          cycleIndex: cycle.index,
          scheduledOn: cycle.scheduledOn,
          templateVersion: template.version,
          outcome: entitled ? "pending" : "skipped_plan",
          reasonCode: entitled ? null : "plan",
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: recurringCycles.id });
      generated = cycle.index + 1;
      if (claimed && !entitled) {
        skipped += 1;
      }
    }

    if (skipped > 0) {
      // One notice per template and downgrade, not one per skipped cycle.
      const [change] = await database
        .select({ id: planChanges.id })
        .from(planChanges)
        .where(eq(planChanges.companyId, template.companyId))
        .orderBy(desc(planChanges.createdAt))
        .limit(1);
      await createNotification({
        database,
        companyId: template.companyId,
        kind: "recurring_skipped_plan",
        payload: { template_id: template.id },
        idempotencyKey: `recurring_skipped:${template.id}:${change?.id ?? "none"}`,
        now,
      });
    }

    const rows = await database
      .select({ id: recurringCycles.id })
      .from(recurringCycles)
      .where(
        and(
          eq(recurringCycles.templateId, template.id),
          eq(recurringCycles.outcome, "pending"),
        ),
      );
    for (const row of rows) {
      await dependencies.queue.send(createRecurringRunMessage(row.id, now));
      enqueued += 1;
    }

    const next = pendingCycles(rule, generated, "9999-12-31", 1)[0];
    await database
      .update(recurringTemplates)
      .set({
        nextRunOn: next?.scheduledOn ?? null,
        status: next ? "active" : "finished",
        updatedAt: now,
      })
      .where(eq(recurringTemplates.id, template.id));
  }
  return enqueued;
}

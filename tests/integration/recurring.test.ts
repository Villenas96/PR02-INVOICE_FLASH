import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  clients,
  companies,
  documents,
  emailDeliveries,
  recurringCycles,
  recurringTemplates,
  userNotifications,
} from "@/db/schema";
import type { CompanyContext } from "@/services/context";
import { planRecurringCycles } from "@/services/recurring/planner";
import { runRecurringCycle } from "@/services/recurring/run-cycle";
import { createTemplate, updateTemplate } from "@/services/recurring/templates";
import { jobMessageSchema } from "@/workers/messages";

import { createIntegrationDatabase } from "./database";
import {
  createOwner,
  createSeries,
  type OwnerFixture,
  recordingQueue,
} from "./fixtures";

const database = createIntegrationDatabase();

const LINE = {
  description: "Cuota mensual",
  quantity: "1",
  unit_price_cents: 10_000,
  tax_rate: "21.00",
};

function contextOf(
  owner: OwnerFixture,
  plan: "pro" | "essential" = "pro",
): CompanyContext {
  return {
    userId: owner.userId,
    companyId: owner.companyId,
    role: "owner",
    plan,
  };
}

async function setup(
  action: "draft" | "issue" | "issue_and_send" = "issue_and_send",
) {
  const owner = await createOwner(database, { plan: "pro" });
  await createSeries(database, owner.companyId, "invoice");
  const template = await createTemplate({
    database,
    context: contextOf(owner),
    now: new Date("2026-01-30T10:00:00.000Z"),
    data: {
      client_id: owner.clientId,
      lines: [LINE],
      due_days: 30,
      frequency: "monthly",
      start_on: "2026-01-31",
      action,
      max_cycles: 12,
    },
  });
  return { owner, template };
}

function day(date: string): Date {
  return new Date(`${date}T05:00:00.000Z`);
}

/** One planner run and delivery of every message (twice: redelivery). */
async function tick(date: string, twice = true) {
  const jobs = recordingQueue();
  const pdf = recordingQueue();
  const email = recordingQueue();
  await planRecurringCycles({ database, queue: jobs, now: day(date) });
  for (const message of jobs.messages) {
    const job = jobMessageSchema.parse(message);
    if (job.type !== "recurring.run") {
      continue;
    }
    for (let delivery = 0; delivery < (twice ? 2 : 1); delivery += 1) {
      await runRecurringCycle(job.cycleId, {
        database,
        pdfQueue: pdf,
        emailQueue: email,
        now: day(date),
      });
    }
  }
  return { jobs: jobs.messages.length, pdf, email };
}

const MONTH_ENDS = [
  "2026-01-31",
  "2026-02-28",
  "2026-03-31",
  "2026-04-30",
  "2026-05-31",
  "2026-06-30",
  "2026-07-31",
  "2026-08-31",
  "2026-09-30",
  "2026-10-31",
  "2026-11-30",
  "2026-12-31",
];

describe("recurring invoices (SC-008)", () => {
  it("generates exactly 12 invoices over 12 cycles, with numbers, emails and notices", async () => {
    const { owner, template } = await setup();
    for (const date of MONTH_ENDS) {
      await tick(date);
      // The planner can run twice a day without duplicating anything.
      await tick(date, false);
    }

    const invoices = await database
      .select({
        number: documents.number,
        fullNumber: documents.fullNumber,
        issueDate: documents.issueDate,
        status: documents.status,
      })
      .from(documents)
      .where(eq(documents.companyId, owner.companyId))
      .orderBy(asc(documents.number));
    expect(invoices).toHaveLength(12);
    expect(invoices.map((invoice) => invoice.number)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    );
    expect(invoices.map((invoice) => invoice.issueDate)).toEqual(MONTH_ENDS);
    expect(invoices.every((invoice) => invoice.status === "issued")).toBe(true);

    const cycles = await database
      .select({ outcome: recurringCycles.outcome })
      .from(recurringCycles)
      .where(eq(recurringCycles.templateId, template.id));
    expect(cycles).toHaveLength(12);
    expect(cycles.every((cycle) => cycle.outcome === "sent")).toBe(true);

    const deliveries = await database
      .select({ id: emailDeliveries.id })
      .from(emailDeliveries)
      .where(eq(emailDeliveries.companyId, owner.companyId));
    expect(deliveries).toHaveLength(12);

    const notices = await database
      .select({ kind: userNotifications.kind })
      .from(userNotifications)
      .where(eq(userNotifications.companyId, owner.companyId));
    expect(notices).toHaveLength(12);
    expect(
      notices.every((notice) => notice.kind === "recurring_generated"),
    ).toBe(true);

    const [finished] = await database
      .select({
        status: recurringTemplates.status,
        next: recurringTemplates.nextRunOn,
      })
      .from(recurringTemplates)
      .where(eq(recurringTemplates.id, template.id));
    expect(finished).toEqual({ status: "finished", next: null });
  });

  it("recovers the cycles missed during a 3-day outage without duplicates", async () => {
    const owner = await createOwner(database, { plan: "pro" });
    await createSeries(database, owner.companyId, "invoice");
    await createTemplate({
      database,
      context: contextOf(owner),
      now: day("2026-03-01"),
      data: {
        client_id: owner.clientId,
        lines: [LINE],
        due_days: 30,
        frequency: "custom",
        interval_count: 1,
        interval_unit: "day",
        start_on: "2026-03-02",
        action: "issue",
      },
    });
    await tick("2026-03-02");
    // No planner on the 3rd, 4th and 5th.
    await tick("2026-03-06");
    await tick("2026-03-06");

    const dates = await database
      .select({ issueDate: documents.issueDate })
      .from(documents)
      .where(eq(documents.companyId, owner.companyId))
      .orderBy(asc(documents.number));
    expect(dates.map((row) => row.issueDate)).toEqual([
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
    ]);
  });

  it("keeps a draft and notifies when the client was archived", async () => {
    const { owner, template } = await setup("issue");
    await database
      .update(clients)
      .set({ archivedAt: new Date("2026-01-15T00:00:00Z") })
      .where(eq(clients.id, owner.clientId));
    await tick("2026-01-31");

    const [draft] = await database
      .select({ status: documents.status, clientId: documents.clientId })
      .from(documents)
      .where(eq(documents.companyId, owner.companyId));
    expect(draft).toEqual({ status: "draft", clientId: null });
    const [cycle] = await database
      .select({
        outcome: recurringCycles.outcome,
        reason: recurringCycles.reasonCode,
      })
      .from(recurringCycles)
      .where(eq(recurringCycles.templateId, template.id));
    expect(cycle).toEqual({ outcome: "failed", reason: "client_archived" });
    const notices = await database
      .select({ kind: userNotifications.kind })
      .from(userNotifications)
      .where(eq(userNotifications.companyId, owner.companyId));
    expect(notices).toEqual([{ kind: "recurring_failed" }]);
  });

  it("skips cycles after a downgrade with a single notice and continues after upgrading", async () => {
    const owner = await createOwner(database, { plan: "pro" });
    await createSeries(database, owner.companyId, "invoice");
    await createTemplate({
      database,
      context: contextOf(owner),
      now: day("2026-01-01"),
      data: {
        client_id: owner.clientId,
        lines: [LINE],
        due_days: 30,
        frequency: "weekly",
        start_on: "2026-01-05",
        action: "issue",
      },
    });
    await database
      .update(companies)
      .set({ plan: "basic" })
      .where(eq(companies.id, owner.companyId));
    // Basic has no recurring: nothing is generated, one notice is raised.
    await tick("2026-01-05");
    await tick("2026-01-12");
    const generated = await database
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.companyId, owner.companyId));
    expect(generated).toEqual([]);
    const cycles = await database
      .select({ outcome: recurringCycles.outcome })
      .from(recurringCycles);
    expect(cycles.map((cycle) => cycle.outcome)).toEqual([
      "skipped_plan",
      "skipped_plan",
    ]);
    const notices = await database
      .select({ kind: userNotifications.kind })
      .from(userNotifications)
      .where(eq(userNotifications.companyId, owner.companyId));
    expect(notices).toEqual([{ kind: "recurring_skipped_plan" }]);

    // Back to Pro: continues with the next future cycle.
    await database
      .update(companies)
      .set({ plan: "pro" })
      .where(eq(companies.id, owner.companyId));
    await tick("2026-01-19");
    const resumed = await database
      .select({ issueDate: documents.issueDate })
      .from(documents)
      .where(eq(documents.companyId, owner.companyId));
    expect(resumed).toEqual([{ issueDate: "2026-01-19" }]);
  });

  it("edits, pauses and finishes only affect future cycles", async () => {
    const { owner, template } = await setup("draft");
    await tick("2026-01-31");

    const edited = await updateTemplate({
      database,
      context: contextOf(owner),
      templateId: template.id,
      now: day("2026-02-01"),
      data: {
        lines: [{ ...LINE, unit_price_cents: 20_000 }],
      } as never,
    });
    expect(edited.version).toBe(2);
    await tick("2026-02-28");

    const totals = await database
      .select({ total: documents.totalCents, issueDate: documents.issueDate })
      .from(documents)
      .where(eq(documents.companyId, owner.companyId))
      .orderBy(asc(documents.issueDate));
    expect(totals).toEqual([
      { total: 12_100, issueDate: "2026-01-31" },
      { total: 24_200, issueDate: "2026-02-28" },
    ]);
    const versions = await database
      .select({ version: recurringCycles.templateVersion })
      .from(recurringCycles)
      .where(eq(recurringCycles.templateId, template.id))
      .orderBy(asc(recurringCycles.cycleIndex));
    expect(versions).toEqual([{ version: 1 }, { version: 2 }]);

    await updateTemplate({
      database,
      context: contextOf(owner),
      templateId: template.id,
      now: day("2026-03-01"),
      data: { status: "paused" } as never,
    });
    await tick("2026-03-31");
    await tick("2026-04-30");
    expect(
      await database
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.companyId, owner.companyId)),
    ).toHaveLength(2);

    // Resuming skips what fell due while paused instead of billing it.
    const resumed = await updateTemplate({
      database,
      context: contextOf(owner),
      templateId: template.id,
      now: day("2026-05-02"),
      data: { status: "active" } as never,
    });
    expect(resumed.nextRunOn).toBe("2026-05-31");
    const skipped = await database
      .select({ reason: recurringCycles.reasonCode })
      .from(recurringCycles)
      .where(
        and(
          eq(recurringCycles.templateId, template.id),
          eq(recurringCycles.outcome, "skipped_plan"),
        ),
      );
    expect(skipped.map((row) => row.reason)).toEqual(["paused", "paused"]);

    const finished = await updateTemplate({
      database,
      context: contextOf(owner),
      templateId: template.id,
      now: day("2026-05-03"),
      data: { status: "finished" } as never,
    });
    expect(finished).toMatchObject({ status: "finished", nextRunOn: null });
    await tick("2026-05-31");
    expect(
      await database
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.companyId, owner.companyId)),
    ).toHaveLength(2);
  });
});

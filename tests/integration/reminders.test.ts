import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  clients,
  companies,
  documentEvents,
  documents,
  emailDeliveries,
  paymentReminders,
  payments,
} from "@/db/schema";
import type { ReminderPolicy } from "@/lib/reminders";
import { planPaymentReminders } from "@/services/reminder-planner";
import { runReminder } from "@/services/reminder-run";
import { renderNotice } from "@/workers/handlers/notice-email";
import { jobMessageSchema } from "@/workers/messages";

import { createIntegrationDatabase } from "./database";
import { createOwner, type OwnerFixture, recordingQueue } from "./fixtures";

const database = createIntegrationDatabase();

const POLICY: ReminderPolicy = {
  enabled: true,
  days_before: 3,
  on_due: true,
  every_days_after: 7,
  max_count: 3,
};

function day(date: string): Date {
  return new Date(`${date}T05:00:00.000Z`);
}

async function setup(
  overrides: { plan?: "pro" | "essential"; policy?: ReminderPolicy } = {},
) {
  const owner = await createOwner(database, { plan: overrides.plan ?? "pro" });
  await database
    .update(companies)
    .set({ reminderPolicy: overrides.policy ?? POLICY })
    .where(eq(companies.id, owner.companyId));
  return owner;
}

async function issuedInvoice(
  owner: OwnerFixture,
  dueDate = "2026-10-20",
  number = 1,
): Promise<string> {
  const id = crypto.randomUUID();
  await database.insert(documents).values({
    id,
    companyId: owner.companyId,
    documentType: "invoice",
    status: "issued",
    number,
    fullNumber: `2026-${String(number).padStart(4, "0")}`,
    clientId: owner.clientId,
    issueDate: "2026-09-20",
    dueDate,
    subtotalCents: 10_000,
    totalCents: 12_100,
    pdfStatus: "ready",
  });
  return id;
}

/** Planner + delivery of its messages (twice, to prove redelivery is safe). */
async function tick(date: string) {
  const jobs = recordingQueue();
  const email = recordingQueue();
  await planPaymentReminders({ database, queue: jobs, now: day(date) });
  for (const message of jobs.messages) {
    const job = jobMessageSchema.parse(message);
    if (job.type === "reminder.send") {
      for (let delivery = 0; delivery < 2; delivery += 1) {
        await runReminder(job.reminderId, {
          database,
          emailQueue: email,
          now: day(date),
        });
      }
    }
  }
  return { planned: jobs.messages.length, emails: email.messages.length };
}

async function reminders(documentId: string) {
  return database
    .select({
      sequence: paymentReminders.sequence,
      scheduledOn: paymentReminders.scheduledOn,
      outcome: paymentReminders.outcome,
    })
    .from(paymentReminders)
    .where(eq(paymentReminders.documentId, documentId))
    .orderBy(asc(paymentReminders.sequence));
}

describe("payment reminders (3 days before, on due, every 7 days, max 3)", () => {
  it("sends on the exact dates, once per invoice and day, whatever the reruns", async () => {
    const owner = await setup();
    const invoiceId = await issuedInvoice(owner);
    const sent: Record<string, number> = {};
    for (const date of [
      "2026-10-16",
      "2026-10-17",
      "2026-10-17",
      "2026-10-18",
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-27",
      "2026-10-27",
      "2026-11-03",
      "2026-11-10",
    ]) {
      const result = await tick(date);
      sent[date] = (sent[date] ?? 0) + result.emails;
    }
    expect(await reminders(invoiceId)).toEqual([
      { sequence: 1, scheduledOn: "2026-10-17", outcome: "sent" },
      { sequence: 2, scheduledOn: "2026-10-20", outcome: "sent" },
      { sequence: 3, scheduledOn: "2026-10-27", outcome: "sent" },
    ]);
    expect(sent["2026-10-17"]).toBe(1);
    expect(sent["2026-10-27"]).toBe(1);

    const deliveries = await database
      .select({
        purpose: emailDeliveries.purpose,
        recipient: emailDeliveries.recipientEmail,
        payload: emailDeliveries.payload,
      })
      .from(emailDeliveries)
      .where(eq(emailDeliveries.companyId, owner.companyId));
    expect(deliveries).toHaveLength(3);
    expect(deliveries[0]).toMatchObject({
      purpose: "payment_reminder",
      recipient: "administracion@cliente.example",
    });
    expect(JSON.stringify(deliveries[0]?.payload)).not.toMatch(
      /cents|iban|121/i,
    );

    const events = await database
      .select({ event: documentEvents.event })
      .from(documentEvents)
      .where(
        and(
          eq(documentEvents.documentId, invoiceId),
          eq(documentEvents.event, "reminder_sent"),
        ),
      );
    expect(events).toHaveLength(3);
  });

  it("renders the email from the stored invoice: pending amount, due date, method and link", async () => {
    const owner = await setup();
    const invoiceId = await issuedInvoice(owner);
    await database
      .update(documents)
      .set({
        collectionMethodSnapshot: {
          label: "Transferencia",
          holder: "Estudio Norte",
          iban: "ES9121000418450200051332",
        },
      })
      .where(eq(documents.id, invoiceId));
    await database.insert(payments).values({
      id: crypto.randomUUID(),
      companyId: owner.companyId,
      documentId: invoiceId,
      amountCents: 2_100,
      paidOn: "2026-10-01",
    });
    await tick("2026-10-17");

    const [delivery] = await database
      .select({ payload: emailDeliveries.payload })
      .from(emailDeliveries)
      .where(eq(emailDeliveries.companyId, owner.companyId));
    const rendered = await renderNotice(
      "payment_reminder",
      delivery?.payload as Record<string, unknown>,
      {
        appBaseUrl: "https://factum.example",
        database,
        now: day("2026-10-17"),
      },
    );
    expect(rendered?.subject).toBe("Recordatorio de pago: factura 2026-0001");
    expect(rendered?.text).toMatch(/100,00\s€/);
    expect(rendered?.text).toContain("20/10/2026");
    expect(rendered?.text).toContain("ES91 2100 0418 4502 0005 1332");
    expect(rendered?.text).toMatch(/https:\/\/factum\.example\/d\/\S+/);
  });

  it("stops when the invoice is paid or voided between planning and sending", async () => {
    const owner = await setup();
    const paid = await issuedInvoice(owner, "2026-10-20", 1);
    const voided = await issuedInvoice(owner, "2026-10-20", 2);
    const jobs = recordingQueue();
    await planPaymentReminders({
      database,
      queue: jobs,
      now: day("2026-10-17"),
    });
    expect(jobs.messages).toHaveLength(2);

    await database.insert(payments).values({
      id: crypto.randomUUID(),
      companyId: owner.companyId,
      documentId: paid,
      amountCents: 12_100,
      paidOn: "2026-10-17",
    });
    await database
      .update(documents)
      .set({ status: "voided" })
      .where(eq(documents.id, voided));
    const email = recordingQueue();
    for (const message of jobs.messages) {
      const job = jobMessageSchema.parse(message);
      if (job.type === "reminder.send") {
        await runReminder(job.reminderId, {
          database,
          emailQueue: email,
          now: day("2026-10-17"),
        });
      }
    }
    expect(email.messages).toEqual([]);
    expect((await reminders(paid))[0]?.outcome).toBe("skipped_paid");
    expect((await reminders(voided))[0]?.outcome).toBe("skipped_paid");

    // Later dates plan nothing for a paid invoice.
    const later = await tick("2026-10-20");
    expect(later.planned).toBe(0);
  });

  it("records skipped_no_email and warns; opt-outs plan nothing", async () => {
    const owner = await setup();
    await database
      .update(clients)
      .set({ email: null })
      .where(eq(clients.id, owner.clientId));
    const noEmail = await issuedInvoice(owner, "2026-10-20", 1);
    await tick("2026-10-17");
    expect(await reminders(noEmail)).toEqual([
      { sequence: 1, scheduledOn: "2026-10-17", outcome: "skipped_no_email" },
    ]);

    const second = await setup();
    const optedOutInvoice = await issuedInvoice(second, "2026-10-20", 1);
    await database
      .update(documents)
      .set({ remindersEnabled: false })
      .where(eq(documents.id, optedOutInvoice));
    const optedOutClient = await issuedInvoice(second, "2026-10-20", 2);
    await database
      .update(clients)
      .set({ remindersEnabled: false })
      .where(eq(clients.id, second.clientId));
    await tick("2026-10-17");
    expect(await reminders(optedOutInvoice)).toEqual([]);
    expect(await reminders(optedOutClient)).toEqual([]);
  });

  it("is Pro only and off by default", async () => {
    const essential = await setup({ plan: "essential" });
    const lonely = await issuedInvoice(essential);
    const pro = await createOwner(database, { plan: "pro" });
    const noPolicy = await issuedInvoice(pro);
    const result = await tick("2026-10-17");
    expect(result.planned).toBe(0);
    expect(await reminders(lonely)).toEqual([]);
    expect(await reminders(noPolicy)).toEqual([]);
  });
});

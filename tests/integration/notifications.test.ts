import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { emailDeliveries } from "@/db/schema";

import { createIntegrationDatabase } from "./database";
import { recordingQueue } from "./fixtures";
import {
  APP_BASE_URL,
  authenticatedRequest,
  createTenant,
  routeContext,
} from "./http";

process.env.BETTER_AUTH_SECRET =
  "invoice-flash-contract-secret-at-least-thirty-two-characters";
process.env.BETTER_AUTH_URL = APP_BASE_URL;

const database = createIntegrationDatabase();
vi.mock("@/db", () => ({ createDatabase: () => database }));
vi.mock("@/db/index", () => ({ createDatabase: () => database }));

const { auth, setAuthEmailDeliveryHandler } = await import("@/lib/auth");
const { createNotification } = await import("@/services/notifications");
const { GET: listRoute } = await import("@/app/api/v1/notifications/route");
const { POST: readRoute } = await import(
  "@/app/api/v1/notifications/[id]/read/route"
);
const { renderNotice, USER_NOTIFICATION_TEMPLATE } = await import(
  "@/workers/handlers/notice-email"
);

beforeEach(() => {
  setAuthEmailDeliveryHandler(() => Promise.resolve());
});

interface ListBody {
  data: Array<{ id: string; title: string; href: string | null }>;
  next_cursor: string | null;
  unread_count: number;
}

describe("user notifications", () => {
  it("is idempotent per origin, paginates and counts unread", async () => {
    const tenant = await createTenant(auth, database);
    for (let index = 0; index < 3; index += 1) {
      await createNotification({
        database,
        companyId: tenant.companyId,
        kind: "recurring_generated",
        payload: { document_number: `2026-000${index}` },
        idempotencyKey: `recurring_cycle:${tenant.companyId}:${index}`,
        now: new Date(Date.UTC(2026, 9, 20, 5, index)),
      });
    }
    const repeated = await createNotification({
      database,
      companyId: tenant.companyId,
      kind: "recurring_generated",
      payload: { document_number: "2026-0000" },
      idempotencyKey: `recurring_cycle:${tenant.companyId}:0`,
    });
    expect(repeated).toBeNull();

    const first = await listRoute(
      authenticatedRequest(tenant, "/api/v1/notifications?limit=2"),
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as ListBody;
    expect(firstBody.unread_count).toBe(3);
    expect(firstBody.data.map((item) => item.title)).toEqual([
      "Factura recurrente generada",
      "Factura recurrente generada",
    ]);
    expect(firstBody.next_cursor).not.toBeNull();

    const second = (await (
      await listRoute(
        authenticatedRequest(
          tenant,
          `/api/v1/notifications?limit=2&cursor=${firstBody.next_cursor}`,
        ),
      )
    ).json()) as ListBody;
    expect(second.data).toHaveLength(1);
    expect(second.next_cursor).toBeNull();

    const target = firstBody.data[0]?.id as string;
    const read = await readRoute(
      authenticatedRequest(tenant, `/api/v1/notifications/${target}/read`, {
        method: "POST",
      }),
      routeContext({ id: target }),
    );
    expect(read.status).toBe(204);
    const unread = (await (
      await listRoute(
        authenticatedRequest(tenant, "/api/v1/notifications?unread=true"),
      )
    ).json()) as ListBody;
    expect(unread.unread_count).toBe(2);
    expect(unread.data.map((item) => item.id)).not.toContain(target);
  });

  it("never lets another user read or mark someone else's notices", async () => {
    const owner = await createTenant(auth, database);
    const stranger = await createTenant(auth, database);
    const id = (await createNotification({
      database,
      companyId: owner.companyId,
      kind: "export_ready",
      payload: {},
      idempotencyKey: `export_job:${crypto.randomUUID()}`,
    })) as string;

    const list = (await (
      await listRoute(authenticatedRequest(stranger, "/api/v1/notifications"))
    ).json()) as ListBody;
    expect(list.data.map((item) => item.id)).not.toContain(id);

    const read = await readRoute(
      authenticatedRequest(stranger, `/api/v1/notifications/${id}/read`, {
        method: "POST",
      }),
      routeContext({ id }),
    );
    expect(read.status).toBe(404);
  });

  it("emails critical notices once to the owner without sensitive data", async () => {
    const tenant = await createTenant(auth, database);
    const queue = recordingQueue();
    const key = `recurring_cycle:${crypto.randomUUID()}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await createNotification({
        database,
        companyId: tenant.companyId,
        kind: "recurring_failed",
        payload: { template_id: crypto.randomUUID() },
        idempotencyKey: key,
        email: { queue },
      });
    }
    expect(queue.messages).toHaveLength(1);
    const deliveries = await database
      .select({
        template: emailDeliveries.template,
        payload: emailDeliveries.payload,
        recipient: emailDeliveries.recipientEmail,
      })
      .from(emailDeliveries)
      .where(
        and(
          eq(emailDeliveries.companyId, tenant.companyId),
          eq(emailDeliveries.purpose, "user_notice"),
        ),
      );
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.recipient).toBe(tenant.email);
    const rendered = renderNotice(
      USER_NOTIFICATION_TEMPLATE,
      deliveries[0]?.payload as Record<string, unknown>,
      APP_BASE_URL,
    );
    expect(rendered?.subject).toBe("No se pudo generar una factura recurrente");
    expect(rendered?.html).toContain("/recurring/");

    await expect(
      createNotification({
        database,
        companyId: tenant.companyId,
        kind: "export_ready",
        payload: { client_email: "ana@example.test" },
        idempotencyKey: `x:${crypto.randomUUID()}`,
      }),
    ).rejects.toThrow();
  });
});

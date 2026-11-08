import { describe, expect, it } from "vitest";

import {
  assertSafeNotificationPayload,
  NOTIFICATION_KINDS,
  renderNotification,
} from "@/lib/notifications";

describe("notifications", () => {
  it.each(NOTIFICATION_KINDS)("renders Spanish copy for %s", (kind) => {
    const rendered = renderNotification(kind, {});
    expect(rendered.title.length).toBeGreaterThan(0);
    expect(rendered.body.length).toBeGreaterThan(0);
  });

  it("links to the generated document", () => {
    expect(
      renderNotification("recurring_generated", {
        document_id: "0190f3b4-7c1e-7a00-8000-000000000001",
        document_number: "2026-0007",
      }),
    ).toEqual({
      title: "Factura recurrente generada",
      body: "Se ha generado la factura 2026-0007.",
      href: "/documents/0190f3b4-7c1e-7a00-8000-000000000001",
    });
  });

  it("summarises an import", () => {
    expect(
      renderNotification("import_done", {
        created: 40,
        updated: 5,
        skipped: 3,
        errored: 2,
      }).body,
    ).toBe("40 creados, 5 actualizados, 3 omitidos y 2 con errores.");
  });

  it("refuses sensitive payloads", () => {
    expect(() =>
      assertSafeNotificationPayload({ client_email: "x" }),
    ).toThrow();
    expect(() =>
      assertSafeNotificationPayload({ amount_cents: 100 }),
    ).toThrow();
    expect(() =>
      assertSafeNotificationPayload({ note: "ana@example.test" }),
    ).toThrow();
    expect(() =>
      assertSafeNotificationPayload({ ref: "ES9121000418450200051332" }),
    ).toThrow();
    expect(() =>
      assertSafeNotificationPayload({ document_number: "2026-0007" }),
    ).not.toThrow();
  });
});

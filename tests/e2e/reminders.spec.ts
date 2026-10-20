import { expect, test } from "@playwright/test";

import {
  expectAccessible,
  registerVerifyAndSignIn,
  saveFiscalData,
  setCompanyPlan,
} from "./helpers";

/** US11 (specs/002, quickstart V11): payment reminders UI. */

test("Pro configura la política, ve el aviso sin email y desactiva los recordatorios de una factura", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);
  await setCompanyPlan(email, "pro");

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Cobros e impuestos" }).click();
  await page.getByLabel("Enviar recordatorios automáticos").check();
  await page.getByLabel("Días antes del vencimiento").fill("3");
  await page.getByLabel("Repetir cada (días) tras vencer").fill("7");
  await page.getByLabel("Máximo de recordatorios").fill("3");
  await expectAccessible(page);
  await page
    .getByRole("form", { name: "Recordatorios de pago" })
    .getByRole("button", { name: "Guardar" })
    .click();
  await expect(page.getByText("Recordatorios guardados.")).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "Cobros e impuestos" }).click();
  await expect(page.getByLabel("Máximo de recordatorios")).toHaveValue("3");

  // An invoice for a client without email.
  const client = await page.request.post("/api/v1/clients", {
    data: {
      name: "Cliente sin correo",
      tax_id: "A87654321",
      address: "Calle 1, Madrid",
    },
  });
  const { id: clientId } = (await client.json()) as { id: string };
  const created = await page.request.post("/api/v1/documents", {
    data: {
      doc_type: "invoice",
      client_id: clientId,
      due_date: "2030-01-31",
      lines: [
        {
          description: "Servicio",
          quantity: "1",
          unit_price_cents: 10_000,
          tax_rate: "21.00",
        },
      ],
    },
  });
  const { id } = (await created.json()) as { id: string };
  expect(
    (await page.request.post(`/api/v1/documents/${id}/issue`)).status(),
  ).toBe(200);

  await page.goto(`/documents/${id}`);
  const panel = page.getByRole("region", { name: "Recordatorios de pago" });
  await expect(panel.getByText(/no tiene email/)).toBeVisible();
  await expect(
    panel.getByText("Todavía no se ha enviado ningún recordatorio."),
  ).toBeVisible();
  await panel.getByLabel("Enviar recordatorios de esta factura").uncheck();
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Recordatorios de pago" })
      .getByLabel("Enviar recordatorios de esta factura"),
  ).not.toBeChecked();

  // Per-client switch.
  await page.goto(`/clients/${clientId}`);
  const toggle = page.getByLabel("Enviar recordatorios de pago a este cliente");
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.reload();
  await expect(toggle).not.toBeChecked();
});

test("sin Pro, los recordatorios muestran la invitación a mejorar", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);
  await expect(
    page.getByRole("heading", { name: "Recordatorios de pago" }),
  ).toBeVisible();
  const denied = await page.request.put("/api/v1/company", {
    data: { reminder_policy: { enabled: true, on_due: true, max_count: 1 } },
  });
  expect(denied.status()).toBe(403);
});

import { expect, test } from "@playwright/test";
import { testEmail } from "./environment";
import {
  expectAccessible,
  registerVerifyAndSignIn,
  saveFiscalData,
  setCompanyPlan,
} from "./helpers";

/** US10 (specs/002, quickstart V10): recurring invoices UI. */

test("Pro crea, pausa, reanuda y finaliza una recurrencia", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);
  await setCompanyPlan(email, "pro");
  const client = await page.request.post("/api/v1/clients", {
    data: {
      name: "Cliente Recurrente",
      tax_id: "A87654321",
      address: "Calle 1, Madrid",
      email: testEmail("recurrente"),
    },
  });
  expect(client.status()).toBe(201);

  await page.goto("/recurring");
  await expect(
    page.getByText("Todavía no tienes facturas recurrentes"),
  ).toBeVisible();
  await page.getByRole("link", { name: "Nueva recurrencia" }).click();

  await page.getByRole("combobox", { name: "Cliente" }).click();
  await page.keyboard.type("recurrente");
  await page.getByRole("option", { name: /Cliente Recurrente/ }).click();
  await page.getByLabel("Descripción").fill("Cuota de mantenimiento");
  await page.getByLabel("Precio (€)").fill("120,00");
  await page.getByLabel("Cada vez que toca").selectOption("issue");
  await page.getByLabel("Final").selectOption("cycles");
  await page.getByLabel("Número de ciclos").fill("6");
  await expectAccessible(page);
  await page.getByRole("button", { name: "Crear recurrencia" }).click();

  await expect(page).toHaveURL(/\/recurring\/[0-9a-f-]+$/);
  await expect(page.getByText("Activa")).toBeVisible();
  await expect(
    page.getByText("Todavía no se ha generado ningún ciclo."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Pausar" }).click();
  await expect(page.getByText("En pausa")).toBeVisible();
  await page.getByRole("button", { name: "Reanudar" }).click();
  await expect(page.getByText("Activa")).toBeVisible();

  await page.getByRole("button", { name: "Editar" }).click();
  await expect(
    page.getByText(/solo afectan a los próximos ciclos/),
  ).toBeVisible();
  await page.getByLabel("Descripción").fill("Cuota actualizada");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page).toHaveURL(/\/recurring\/[0-9a-f-]+$/);

  await page.getByRole("button", { name: "Finalizar" }).click();
  await expect(page.getByText("Finalizada")).toBeVisible();

  await page.goto("/recurring");
  await expect(
    page.getByRole("link", { name: "Cuota actualizada" }),
  ).toBeVisible();
});

test("sin Pro, /recurring muestra la invitación a mejorar", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);
  await page.goto("/recurring");
  await expect(
    page.getByRole("heading", { name: "Facturas recurrentes" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region").getByRole("link", { name: "Mejorar a Pro" }),
  ).toBeVisible();
  const denied = await page.request.post("/api/v1/recurring-templates", {
    data: {},
  });
  expect(denied.status()).toBe(403);
});

import { expect, type Page, test } from "@playwright/test";

import {
  expectAccessible,
  expectResponsive,
  registerVerifyAndSignIn,
  saveFiscalData,
  setCompanyPlan,
  withDatabase,
} from "./helpers";

/** US3 (specs/002): simple interface by plan (FR-057–FR-060). */

function mainNavigation(page: Page) {
  return page.getByRole("navigation", { name: "Principal" });
}

async function navLabels(page: Page): Promise<string[]> {
  return mainNavigation(page).getByRole("link").allInnerTexts();
}

test("Básico ve la interfaz sencilla y emite con cliente y producto nuevos sin salir del editor", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);

  await page.goto("/dashboard");
  expect((await navLabels(page)).map((label) => label.trim())).toEqual([
    "Facturas",
    "Clientes",
    "Productos",
    "Ajustes",
    "Mejorar a Pro",
  ]);
  await expect(page.getByRole("heading", { name: "Facturas" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Nueva factura" }).first(),
  ).toBeVisible();
  const summary = page.getByRole("region", { name: "Resumen de cobros" });
  await expect(summary).toContainText("Cobrado");
  await expect(summary).toContainText("Pendiente");
  await expect(summary).toContainText("Vencido");
  await expectAccessible(page);
  await expectResponsive(page);

  await mainNavigation(page).getByRole("button", { name: /Nuevo/ }).click();
  await expect(page.getByRole("menuitem", { name: "Factura" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Proforma" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "Nueva factura" }).first().click();
  await expect(page).toHaveURL(/\/documents\/new/);
  await page.getByRole("combobox", { name: "Cliente" }).click();
  await page.keyboard.type("Cliente Nuevo, S.L.");
  await page
    .getByRole("option", { name: /Crear «Cliente Nuevo, S\.L\.»/ })
    .click();
  const clientDialog = page.getByRole("dialog");
  await expect(clientDialog.getByLabel("Nombre o razón social")).toHaveValue(
    "Cliente Nuevo, S.L.",
  );
  await clientDialog.getByLabel("NIF, NIE o CIF").fill("A87654321");
  await clientDialog
    .getByLabel("Dirección fiscal")
    .fill("Avenida del Cliente 2, Valencia");
  await clientDialog
    .getByRole("button", { name: "Crear cliente", exact: true })
    .click();
  await expect(page.getByRole("combobox", { name: "Cliente" })).toContainText(
    "Cliente Nuevo, S.L.",
  );

  await page
    .getByRole("combobox", { name: "Añadir producto del catálogo" })
    .click();
  await page.keyboard.type("Diseño de logotipo");
  await page
    .getByRole("option", { name: /Crear «Diseño de logotipo»/ })
    .click();
  const productDialog = page.getByRole("dialog");
  await expect(productDialog.getByLabel("Descripción")).toHaveValue(
    "Diseño de logotipo",
  );
  await productDialog.getByLabel("Precio unitario").fill("250,00");
  await productDialog.getByRole("button", { name: "Crear producto" }).click();
  const line = page.getByRole("group", { name: "Línea 1" });
  await expect(line.getByLabel("Descripción")).toHaveValue(
    "Diseño de logotipo",
  );
  await expect(line.getByLabel("Precio unitario")).toHaveValue("250,00");
  await expect(page).toHaveURL(/\/documents\/new/);

  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+$/);
  await page.getByRole("button", { name: "Emitir factura" }).click();
  await expect(page.getByText("Emitida", { exact: true })).toBeVisible();

  await page.goto("/catalog");
  await expect(page.getByText("Diseño de logotipo")).toBeVisible();
});

test("el acceso directo a una función Pro muestra una invitación, no un error", async ({
  page,
}) => {
  await registerVerifyAndSignIn(page);
  for (const path of ["/recurring", "/reconciliation"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByText(/Disponible en el plan/)).toContainText("Pro");
    await expect(
      page.getByRole("link", { name: "Mejorar a Pro" }).first(),
    ).toBeVisible();
  }
  await expectAccessible(page);
});

test("Pro tiene interfaz completa, puede pasar a la sencilla con «Más» y al bajar de plan vuelve a la sencilla", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);
  await setCompanyPlan(email, "pro");

  await page.goto("/dashboard");
  const fullLabels = (await navLabels(page)).map((label) => label.trim());
  expect(fullLabels).toEqual(
    expect.arrayContaining(["Resumen", "Documentos", "Recurrentes"]),
  );
  expect(fullLabels).not.toContain("Mejorar a Pro");

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Interfaz" }).click();
  await page.getByLabel("Interfaz sencilla").check();
  await expect(
    mainNavigation(page).getByRole("button", { name: "Más" }),
  ).toBeVisible();
  expect((await navLabels(page)).map((label) => label.trim())).toEqual([
    "Facturas",
    "Clientes",
    "Productos",
    "Ajustes",
  ]);
  await mainNavigation(page).getByRole("button", { name: "Más" }).click();
  await expect(
    page.getByRole("menuitem", { name: "Recurrentes" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // Back to full, then downgrade: the stored preference is ignored.
  await withDatabase(async (database) => {
    await database`
      UPDATE company SET ui_mode = 'full'
      WHERE user_id = (SELECT id FROM "user" WHERE email = ${email})
    `;
  });
  await setCompanyPlan(email, "essential");
  await page.goto("/dashboard");
  // Essential keeps its period export for the advisor (FR-032).
  expect((await navLabels(page)).map((label) => label.trim())).toEqual([
    "Facturas",
    "Clientes",
    "Productos",
    "Gestoría",
    "Ajustes",
    "Mejorar a Pro",
  ]);
  await expect(
    mainNavigation(page).getByRole("button", { name: "Más" }),
  ).toHaveCount(0);
});

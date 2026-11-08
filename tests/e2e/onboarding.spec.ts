import { expect, test } from "@playwright/test";

import {
  expectAccessible,
  registerVerifyAndSignIn,
  saveFiscalData,
} from "./helpers";

/** US14 (specs/002, quickstart V14): setup wizard. */

test("el asistente guía los pasos, se puede omitir, cerrar y retomar desde el aviso", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);

  // A new account is pointed at the wizard from the fiscal banner.
  await page.goto("/documents");
  await page.getByRole("link", { name: "Abrir el asistente" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByText("Paso 1 de 5")).toBeVisible();
  await expectAccessible(page);

  // Fiscal data cannot be skipped by clicking: the step needs real data.
  await expect(
    page.getByRole("button", { name: "Marcar como hecho" }),
  ).toBeDisabled();
  await page.getByLabel("Nombre o razón social").fill("Estudio Flash, S.L.");
  await page.getByLabel("NIF, NIE o CIF").fill("B12345678");
  await page
    .getByLabel("Dirección fiscal")
    .fill("Calle de la Prueba 1, 28001 Madrid");
  await page.getByLabel("Correo de facturación").fill(email);
  await page
    .locator(
      'section[aria-labelledby="company-profile-title"] button[type="submit"]',
    )
    .click();
  await expect(page.getByText("Cambios guardados.")).toBeVisible();
  await page.getByRole("button", { name: "Continuar" }).click();

  // Logo: skipped on purpose.
  await expect(page.getByText("Paso 2 de 5")).toBeVisible();
  await page.getByRole("button", { name: "Omitir este paso" }).click();

  // Close mid-way: nothing is lost and the banner offers to resume.
  await expect(page.getByText("Paso 3 de 5")).toBeVisible();
  await page.getByRole("link", { name: "Cerrar y seguir luego" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const banner = page.getByRole("complementary", {
    name: "Termina de configurar tu negocio",
  });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Paso 3 de 5");
  await expectAccessible(page);
  await banner.getByRole("link", { name: "Continuar" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByText("Paso 3 de 5")).toBeVisible();

  // Collection method skipped, series confirmed.
  await page.getByRole("button", { name: "Omitir este paso" }).click();
  await expect(page.getByText("Paso 4 de 5")).toBeVisible();
  await page.getByRole("button", { name: "Marcar como hecho" }).click();

  // Sample invoice: queued, watermarked, no document created.
  await expect(page.getByText("Paso 5 de 5")).toBeVisible();
  await page
    .getByRole("button", { name: "Generar factura de ejemplo" })
    .click();
  await expect(
    page.getByRole("link", { name: "Abrir el ejemplo en una pestaña nueva" }),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Me gusta, continuar" }).click();
  await expect(
    page.getByRole("heading", { name: "¡Todo listo!" }),
  ).toBeVisible();
  await expectAccessible(page);

  const documents = await page.request.get("/api/v1/documents");
  expect(((await documents.json()) as { items: unknown[] }).items).toEqual([]);

  // Finished: the banner is gone everywhere.
  await page.goto("/documents");
  await expect(
    page.getByRole("complementary", { name: /configurar tu negocio/ }),
  ).toHaveCount(0);
});

test("«Ahora no» oculta el aviso una vez completados los datos fiscales", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);
  await page.goto("/documents");
  await expect(
    page.getByText("Termina de configurar tu negocio"),
  ).toBeVisible();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/company/onboarding") &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Ahora no" }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText("Termina de configurar tu negocio")).toHaveCount(
    0,
  );
  await page.reload();
  await expect(page.getByText("Termina de configurar tu negocio")).toHaveCount(
    0,
  );
});

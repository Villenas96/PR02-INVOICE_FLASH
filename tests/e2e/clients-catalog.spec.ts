import { expect, test } from "@playwright/test";

import {
  expectAccessible,
  registerVerifyAndSignIn,
  saveFiscalData,
  setCompanyPlan,
} from "./helpers";

/** US7 (specs/002, quickstart V7): clients and catalog. */

const FIVE_MINUTES_MS = 5 * 60 * 1_000;

test("busca clientes sin acentos por población y email, archiva y restaura desde la lista", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);
  for (const client of [
    {
      name: "Ferretería Costa",
      city: "Málaga",
      email: "pedidos@costa.example",
    },
    { name: "Estudio Norte", city: "Bilbao", email: "hola@norte.example" },
  ]) {
    const response = await page.request.post("/api/v1/clients", {
      data: { ...client, postal_code: "29001" },
    });
    expect(response.status()).toBe(201);
  }

  await page.goto("/clients");
  const search = page.getByLabel("Buscar");
  await search.fill("malaga");
  const costaRow = page
    .getByRole("row")
    .filter({ hasText: "Ferretería Costa" });
  await expect(costaRow).toBeVisible();
  await expect(costaRow).toContainText("29001 Málaga");
  await expect(
    page.getByRole("row").filter({ hasText: "Estudio Norte" }),
  ).toHaveCount(0);
  await search.fill("NORTE.EXAMPLE");
  await expect(
    page.getByRole("row").filter({ hasText: "Estudio Norte" }),
  ).toBeVisible();

  await search.fill("");
  await page
    .getByRole("row")
    .filter({ hasText: "Ferretería Costa" })
    .getByRole("button", { name: "Archivar" })
    .click();
  await expect(
    page.getByRole("row").filter({ hasText: "Ferretería Costa" }),
  ).toHaveCount(0);
  await page.getByLabel("Mostrar archivados").check();
  const archivedRow = page
    .getByRole("row")
    .filter({ hasText: "Ferretería Costa" });
  await expect(archivedRow).toContainText("Archivado");
  await archivedRow.getByRole("button", { name: "Restaurar" }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "Ferretería Costa" }),
  ).toHaveCount(0);
  await page.getByLabel("Mostrar archivados").uncheck();
  await expect(
    page.getByRole("row").filter({ hasText: "Ferretería Costa" }),
  ).toBeVisible();
  await expectAccessible(page);
});

test("Pro importa un CSV de catálogo con errores por fila y revisa el resumen", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);
  await setCompanyPlan(email, "pro");

  const startedAt = Date.now();
  await page.goto("/catalog");
  await page.getByRole("link", { name: "Importar CSV" }).click();
  await expect(
    page.getByRole("heading", { name: "Importar productos" }),
  ).toBeVisible();
  await page
    .getByLabel("Archivo CSV")
    .setInputFiles("tests/fixtures/csv/catalog-latin1-semicolon.csv");
  await page.getByRole("button", { name: "Analizar archivo" }).click();

  await expect(
    page.getByRole("heading", {
      name: "2. Revisa las columnas y la vista previa",
    }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/50 filas en el archivo/)).toBeVisible();
  await expect(page.getByLabel("Descripción")).toHaveValue("0");
  await expect(page.getByLabel("Precio", { exact: true })).toHaveValue("1");
  await page.getByText(/Ver errores por fila/).click();
  await expect(page.getByText(/no puede ser negativo/).first()).toBeVisible();
  await expectAccessible(page);

  await page.getByLabel("Actualizar su precio, impuesto y unidad").check();
  await page.getByRole("button", { name: "Importar productos" }).click();
  await expect(
    page.getByRole("heading", { name: "Importación completada" }),
  ).toBeVisible({ timeout: 30_000 });
  const created = Number(
    await page.getByRole("definition").first().innerText(),
  );
  expect(created).toBeGreaterThan(30);
  expect(Date.now() - startedAt).toBeLessThan(FIVE_MINUTES_MS);

  await page.getByRole("link", { name: "Ver catálogo" }).click();
  await page.getByLabel("Buscar").fill("auditoria energetica 49");
  await expect(page.getByText("Auditoría energética 49")).toBeVisible();
});

test("una importación de más de 5.000 filas se rechaza con un mensaje claro", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);
  await setCompanyPlan(email, "pro");

  await page.goto("/catalog/import");
  await page
    .getByLabel("Archivo CSV")
    .setInputFiles("tests/fixtures/csv/catalog-5001.csv");
  await page.getByRole("button", { name: "Analizar archivo" }).click();
  await expect(page.getByText(/supera 5 MB o 5.000 filas/)).toBeVisible({
    timeout: 30_000,
  });
});

test("sin Pro, la importación muestra la invitación a mejorar", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);
  await page.goto("/catalog");
  await expect(page.getByRole("link", { name: "Importar CSV" })).toHaveCount(0);
  await page.goto("/catalog/import");
  await expect(
    page.getByRole("heading", { name: "Importación de productos" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Importación de productos" })
      .getByRole("link", { name: "Mejorar a Pro" }),
  ).toBeVisible();
});

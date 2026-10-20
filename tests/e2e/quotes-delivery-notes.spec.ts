import { expect, type Page, test } from "@playwright/test";

import {
  createClientInEditor,
  expectAccessible,
  fillFirstLine,
  registerVerifyAndSignIn,
  saveFiscalData,
  selectClientInEditor,
} from "./helpers";

/** US9 (specs/002, quickstart V9): quotes, delivery notes and invoicing. */

async function createAndIssue(page: Page, type: string, button: RegExp) {
  await page.goto(`/documents/new?type=${type}`);
  if (type === "quote") {
    await page.getByLabel("Válido hasta").fill("2030-01-31");
  }
  await createClientInEditor(page);
  await fillFirstLine(page);
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+/);
  await page.getByRole("button", { name: button }).click();
  await expect(page.getByText("Emitida", { exact: true })).toBeVisible();
  return page.url();
}

test("presupuesto aceptado → albarán; dos albaranes → una factura; refacturar se bloquea", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);

  const quoteUrl = await createAndIssue(page, "quote", /Emitir presupuesto/);
  await expect(
    page.getByRole("heading", { name: "PRE-2026-0001" }),
  ).toBeVisible();
  await expect(page.getByText("Pendiente").first()).toBeVisible();
  await page.getByRole("button", { name: "Aceptado" }).click();
  await expect(page.getByText("Aceptado").first()).toBeVisible();

  await page.getByRole("button", { name: "Convertir en albarán" }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+/);
  await page.getByRole("button", { name: /Emitir albarán/ }).click();
  await expect(page.getByText("Emitida", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "ALB-2026-0001" }),
  ).toBeVisible();
  await expect(page.getByText("Documentos de origen")).toBeVisible();

  // Repeating the conversion asks for confirmation.
  await page.goto(quoteUrl);
  await expect(page.getByText("Convertido").first()).toBeVisible();
  await page.getByRole("button", { name: "Crear otro albarán" }).click();
  await expect(page.getByText(/¿Crear otro albarán/)).toBeVisible();
  await page.getByRole("button", { name: "Cancelar" }).click();

  // A second delivery note, then both invoiced together from the list.
  await page.goto("/documents/new?type=delivery_note");
  await selectClientInEditor(page, "cliente", /Cliente E2E/);
  await fillFirstLine(page);
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await page.getByRole("button", { name: /Emitir albarán/ }).click();
  await expect(page.getByText("Emitida", { exact: true })).toBeVisible();

  await page.goto("/documents?type=delivery_note");
  const boxes = page.getByRole("checkbox", { name: /para facturar/ });
  await expect(boxes).toHaveCount(2);
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByRole("button", { name: "Facturar" }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+/);
  await expect(page.getByText("Borrador sin número")).toBeVisible();
  await expect(page.getByText(/Albarán ALB-2026-0001/)).toBeVisible();
  await expect(page.getByText(/Albarán ALB-2026-0002/)).toBeVisible();
  await expectAccessible(page);

  // Issuing it, the notes cannot be invoiced again.
  await page.getByRole("button", { name: "Emitir factura" }).click();
  await expect(page.getByText("Emitida", { exact: true })).toBeVisible();
  const invoiceUrl = page.url();
  await page.goto("/documents?type=delivery_note");
  await expect(
    page.getByRole("checkbox", { name: /para facturar/ }),
  ).toHaveCount(0);
  await expect(page.getByText("Facturado").first()).toBeVisible();

  // Voiding the invoice releases the notes.
  await page.goto(invoiceUrl);
  await page.getByRole("button", { name: "Anular factura" }).click();
  await page.getByRole("button", { name: "Confirmar anulación" }).click();
  await expect(page.getByText("Anulada", { exact: true })).toBeVisible();
  await page.goto("/documents?type=delivery_note");
  await expect(
    page.getByRole("checkbox", { name: /para facturar/ }),
  ).toHaveCount(2);
});

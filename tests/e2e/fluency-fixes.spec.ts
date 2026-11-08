import { expect, test } from "@playwright/test";

import {
  createClientInEditor,
  expectAccessible,
  expectNoReload,
  expectResponsive,
  fillFirstLine,
  markPage,
  registerVerifyAndSignIn,
  saveFiscalData,
} from "./helpers";

/**
 * US1 (specs/002): fluency fixes found in real use. Every check runs without
 * reloading the page (FR-002, FR-003, FR-004).
 */

test("el banner de datos fiscales desaparece al guardarlos, sin recargar", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  const banner = page.getByRole("heading", {
    name: "Completa tus datos fiscales para emitir",
  });
  await expect(banner).toBeVisible();
  await markPage(page);

  await saveFiscalData(page, email);

  await expect(banner).toBeHidden();
  await expectNoReload(page);
});

test("el contador pasa de 0 de 5 a 1 de 5 al emitir, sin recargar", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);

  const counter = page
    .getByRole("banner")
    .getByRole("progressbar", { name: "facturas emitidas este mes" });
  await expect(counter).toHaveAttribute("aria-valuenow", "0");
  await expect(page.getByRole("banner")).toContainText("0 de 5");

  await page.goto("/documents/new");
  await markPage(page);
  await createClientInEditor(page);
  await fillFirstLine(page);
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+$/);
  await page.getByRole("button", { name: "Emitir factura" }).click();
  await expect(page.getByText("Emitida", { exact: true })).toBeVisible();

  await expect(counter).toHaveAttribute("aria-valuenow", "1");
  await expect(page.getByRole("banner")).toContainText("1 de 5");
  await expectNoReload(page);
});

test("el cliente seleccionado se muestra por nombre y NIF, también al reabrir el borrador", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);
  await page.goto("/documents/new");

  await createClientInEditor(page, "Talleres Martínez, S.L.", "B12345674");
  const picker = page.getByRole("combobox", { name: "Cliente" });
  await expect(picker).toContainText("Talleres Martínez, S.L.");
  await expect(picker).toContainText("B12345674");

  await fillFirstLine(page);
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+$/);
  const documentId = new URL(page.url()).pathname.split("/").at(-1) ?? "";

  const main = page.getByRole("main");
  await expect(main).toContainText("Talleres Martínez, S.L.");
  await expect(main).toContainText("B12345674");
  await expect(main).not.toContainText(documentId.slice(0, 8));

  await page.getByRole("link", { name: "Editar" }).click();
  await expect(page).toHaveURL(new RegExp(`/documents/${documentId}/edit$`));
  const reopenedPicker = page.getByRole("combobox", { name: "Cliente" });
  await expect(reopenedPicker).toContainText("Talleres Martínez, S.L.");
  await expect(reopenedPicker).toContainText("B12345674");

  await reopenedPicker.click();
  await page.keyboard.type("talleres");
  await expect(
    page.getByRole("option", { name: /Talleres Martínez/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expectAccessible(page);
  await expectResponsive(page);
});

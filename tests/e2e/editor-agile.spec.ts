import { expect, test } from "@playwright/test";

import {
  chooseLineTax,
  expectAccessible,
  fillFirstLine,
  registerVerifyAndSignIn,
  saveFiscalData,
  selectClientInEditor,
  withDatabase,
} from "./helpers";

/** US4 (specs/002): a faster document editor. */

const NINETY_SECONDS_MS = 90_000;

test("busca cliente y producto, guarda un producto desde la línea, cambia de serie, edita, duplica, elimina, emite e imprime", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);
  await withDatabase(async (database) => {
    const [company] = await database<{ id: string }[]>`
      SELECT company.id FROM company JOIN "user" ON "user".id = company.user_id
      WHERE "user".email = ${email}
    `;
    await database`
      INSERT INTO client (id, company_id, name, tax_id, address, created_at, updated_at)
      VALUES (${crypto.randomUUID()}, ${company?.id ?? ""}, 'Ana Ibáñez Consultores', 'B11223344', 'Calle Sol 1, Sevilla', now(), now())
    `;
    await database`
      INSERT INTO catalog_item (id, company_id, description, unit_price_cents, tax_rate, unit, created_at, updated_at)
      VALUES (${crypto.randomUUID()}, ${company?.id ?? ""}, 'Hora de diseño', 4500, 21.00, 'hora', now(), now())
    `;
    await database`
      INSERT INTO document_series (id, company_id, document_type, prefix, next_number, is_default)
      VALUES (${crypto.randomUUID()}, ${company?.id ?? ""}, 'invoice', 'B-', 1, false)
    `;
  });

  // SC-003: a configured user creates and issues an invoice in < 90 s.
  const startedAt = Date.now();
  await page.goto("/documents/new");
  await selectClientInEditor(page, "ibanez", /Ana Ibáñez Consultores/);
  await page
    .getByRole("combobox", { name: "Añadir producto del catálogo" })
    .click();
  await page.keyboard.type("diseño");
  await page.getByRole("option", { name: /Hora de diseño/ }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  const productLine = page.getByRole("group", { name: "Línea 1" });
  await expect(productLine.getByLabel("Descripción")).toHaveValue(
    "Hora de diseño",
  );
  await expect(
    productLine.getByRole("combobox", { name: "Unidad" }),
  ).toContainText("hora");
  await expect(productLine.getByText("En catálogo")).toBeVisible();

  await page.getByRole("button", { name: "Añadir línea" }).click();
  const manualLine = page.getByRole("group", { name: "Línea 2" });
  await manualLine.getByLabel("Descripción").fill("Revisión de marca");
  await manualLine.getByLabel("Precio unitario").fill("80,00");
  await chooseLineTax(page, manualLine, "IVA 10 %");
  await manualLine.getByRole("button", { name: "Guardar en catálogo" }).click();
  await expect(manualLine.getByText("En catálogo")).toBeVisible();

  await page.getByRole("combobox", { name: "Serie", exact: true }).click();
  await page.getByRole("option", { name: /^B-/ }).click();
  await expect(
    page.getByRole("combobox", { name: "Serie", exact: true }),
  ).toContainText("B-");

  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+$/);
  const draftUrl = page.url();

  // Edit from the detail.
  await page.getByRole("link", { name: "Editar" }).click();
  await expect(
    page.getByRole("combobox", { name: "Serie", exact: true }),
  ).toContainText("B-");
  await page
    .getByRole("group", { name: "Línea 2" })
    .getByLabel("Cantidad")
    .fill("2");
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page).toHaveURL(draftUrl);

  await page.getByRole("button", { name: "Emitir factura" }).click();
  await expect(page.getByText("Emitida", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "B-0001" })).toBeVisible();
  expect(Date.now() - startedAt).toBeLessThan(NINETY_SECONDS_MS);

  // Duplicate, then delete the duplicate from the list with confirmation.
  await page
    .getByRole("button", { name: "Duplicar como nuevo borrador" })
    .click();
  await expect(page.getByText("Borrador sin número")).toBeVisible();
  await page.goto("/documents");
  const draftRow = page
    .getByRole("row")
    .filter({ hasText: "Borrador sin número" });
  await draftRow.getByRole("button", { name: /Acciones de/ }).click();
  await page.getByRole("menuitem", { name: "Eliminar" }).click();
  await page.getByRole("button", { name: "Eliminar borrador" }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "Borrador sin número" }),
  ).toHaveCount(0);

  // Print opens the printable view and the print dialog.
  await page.addInitScript(() => {
    window.print = () => {
      (window as unknown as { __printed?: boolean }).__printed = true;
    };
  });
  await page.goto(`${draftUrl}/print`);
  await expect(page.getByRole("heading", { name: "B-0001" })).toBeVisible();
  await expect(page.getByText("Revisión de marca")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __printed?: boolean }).__printed === true,
      ),
    )
    .toBe(true);
  await page.emulateMedia({ media: "print" });
  await expect(
    page.getByRole("navigation", { name: "Principal" }),
  ).toBeHidden();
});

test("la primera proforma crea su serie sin configurar nada", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);
  await page.goto("/documents/new?type=proforma");
  await fillFirstLine(page);
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page).toHaveURL(/series_created=PRO-/);
  await expect(page.getByText(/Hemos creado la serie PRO-/)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectAccessible(page);
});

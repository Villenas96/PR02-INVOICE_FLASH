import { expect, test } from "@playwright/test";

import {
  expectAccessible,
  registerVerifyAndSignIn,
  saveFiscalData,
  setCompanyPlan,
  withDatabase,
} from "./helpers";

/** US12 (specs/002, quickstart V12): bank reconciliation. */

// Account 2100-0001-0123456789 of tests/fixtures/bank/sample.n43.
const IBAN = "ES8121000001000123456789";

test("importa Norma 43, confirma una sugerencia, deshace y no duplica al reimportar", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);
  await setCompanyPlan(email, "pro");
  const method = await page.request.post("/api/v1/collection-methods", {
    data: {
      kind: "bank_account",
      label: "Cuenta principal",
      holder_name: "Estudio",
      iban: IBAN,
    },
  });
  expect(method.status(), await method.text()).toBe(201);

  const invoiceId = crypto.randomUUID();
  await withDatabase(async (database) => {
    const [company] = await database<{ id: string }[]>`
      SELECT company.id FROM company JOIN "user" ON "user".id = company.user_id
      WHERE "user".email = ${email}
    `;
    const clientId = crypto.randomUUID();
    await database`
      INSERT INTO client (id, company_id, name, tax_id, created_at, updated_at)
      VALUES (${clientId}, ${company?.id ?? ""}, 'Talleres Martínez SL', 'B12345674', now(), now())
    `;
    await database`
      INSERT INTO document (id, company_id, document_type, status, number, full_number,
        client_id, issue_date, due_date, subtotal_cents, total_cents, pdf_status,
        created_at, updated_at)
      VALUES (${invoiceId}, ${company?.id ?? ""}, 'invoice', 'issued', 1, 'F-2026-0001',
        ${clientId}, '2026-02-20', '2026-03-15', 16637, 16637, 'ready', now(), now())
    `;
  });

  await page.goto("/reconciliation");
  await expect(
    page.getByRole("heading", { name: "Conciliación" }),
  ).toBeVisible();
  await page
    .getByLabel("Archivo")
    .setInputFiles("tests/fixtures/bank/sample.n43");
  await page.getByRole("button", { name: "Analizar" }).click();
  await expect(
    page.getByText(/20 movimientos \(16 ingresos y 4 cargos\)/),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expectAccessible(page);
  await page.getByRole("button", { name: "Importar movimientos" }).click();
  await expect(
    page.getByText(/Importación completada: 20 movimientos nuevos/),
  ).toBeVisible({
    timeout: 30_000,
  });

  const suggestion = page
    .getByRole("listitem")
    .filter({ hasText: "F-2026-0001" })
    .first();
  await expect(suggestion).toContainText("Confianza alta");
  await suggestion.getByRole("button", { name: /Registrar cobro de/ }).click();
  await expect(
    page.getByRole("region", { name: "Sugerencias" }).getByText("F-2026-0001"),
  ).toHaveCount(0);

  const paid = await page.request.get(`/api/v1/documents/${invoiceId}`);
  expect(
    ((await paid.json()) as { payment_status: string }).payment_status,
  ).toBe("paid");

  const movements = page.getByRole("region", { name: "Movimientos" });
  await movements
    .getByRole("button", { name: /Deshacer/ })
    .first()
    .click();
  const unpaid = await page.request.get(`/api/v1/documents/${invoiceId}`);
  expect(
    ((await unpaid.json()) as { payment_status: string }).payment_status,
  ).not.toBe("paid");

  // Importing the same file again brings nothing new.
  await page
    .getByLabel("Archivo")
    .setInputFiles("tests/fixtures/bank/sample.n43");
  await page.getByRole("button", { name: "Analizar" }).click();
  await expect(page.getByText(/0 nuevos/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/20 ya importados/)).toBeVisible();
});

test("sin Pro, la conciliación muestra la invitación a mejorar", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);
  await page.goto("/reconciliation");
  await expect(
    page.getByRole("heading", { name: "Conciliación bancaria" }),
  ).toBeVisible();
  const denied = await page.request.get("/api/v1/bank-transactions");
  expect(denied.status()).toBe(403);
});

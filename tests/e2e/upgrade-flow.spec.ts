import { expect, type Page, test } from "@playwright/test";

import {
  createClientInEditor,
  expectAccessible,
  expectResponsive,
  fillFirstLine,
  registerVerifyAndSignIn,
  saveFiscalData,
  withDatabase,
} from "./helpers";

/**
 * US2 (specs/002): reaching the invoice quota offers an upgrade that keeps
 * the draft. The paid part needs Stripe test mode (test keys and the Stripe
 * CLI forwarding webhooks): set E2E_STRIPE_SECRET_KEY to run it.
 */

async function seedPricesAndUsage(email: string): Promise<void> {
  await withDatabase(async (database) => {
    await database`
      INSERT INTO billing_price (lookup_key, stripe_price_id, plan, interval, unit_amount_cents, currency, active, updated_at)
      VALUES
        ('essential_monthly', 'price_e2e_essential_monthly', 'essential', 'month', 900, 'eur', true, now()),
        ('essential_yearly', 'price_e2e_essential_yearly', 'essential', 'year', 9000, 'eur', true, now())
      ON CONFLICT (lookup_key) DO NOTHING
    `;
    const [company] = await database<{ id: string }[]>`
      SELECT company.id FROM company
      JOIN "user" ON "user".id = company.user_id
      WHERE "user".email = ${email}
    `;
    const [client] = await database<{ id: string }[]>`
      SELECT id FROM client WHERE company_id = ${company?.id ?? ""} LIMIT 1
    `;
    const seriesId = crypto.randomUUID();
    await database`
      INSERT INTO document_series (id, company_id, document_type, prefix, next_number, is_default)
      VALUES (${seriesId}, ${company?.id ?? ""}, 'invoice', 'E2E-', 6, false)
    `;
    for (let number = 1; number <= 5; number += 1) {
      await database`
        INSERT INTO document (id, company_id, document_type, status, series_id, number, full_number, client_id, issue_date, issued_at, pdf_status, created_at, updated_at)
        VALUES (${crypto.randomUUID()}, ${company?.id ?? ""}, 'invoice', 'issued', ${seriesId}, ${number}, ${`E2E-000${number}`}, ${client?.id ?? null}, CURRENT_DATE, now(), 'ready', now(), now())
      `;
    }
  });
}

async function draftAtQuota(page: Page): Promise<string> {
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);
  await page.goto("/documents/new");
  await createClientInEditor(page);
  await fillFirstLine(page);
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+$/);
  const documentId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
  await seedPricesAndUsage(email);
  await page.reload();
  return documentId;
}

test("al agotar las facturas, la invitación a mejorar conserva el borrador", async ({
  page,
}) => {
  const documentId = await draftAtQuota(page);

  await expect(
    page.getByRole("button", { name: "Emitir factura" }),
  ).toBeDisabled();
  await expect(page.getByRole("banner")).toContainText("5 de 5");
  await page.getByRole("link", { name: "Mejorar plan" }).click();
  await expect(page).toHaveURL(new RegExp(`/billing\\?resume=${documentId}$`));
  await expect(
    page.getByText(/Tu borrador se conserva sin número/),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Esencial" }).getByText("9,00 €"),
  ).toBeVisible();
  await page.getByText("Anual").click();
  await expect(
    page.getByRole("region", { name: "Esencial" }).getByText("90,00 €"),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Pro" }).getByText("Próximamente"),
  ).toBeVisible();
  await expectAccessible(page);
  await expectResponsive(page);

  await page.goto(`/documents/${documentId}`);
  await expect(page.getByText("Borrador", { exact: true })).toBeVisible();
  await expect(page.getByText("Borrador sin número")).toBeVisible();
});

test("contratar Esencial con tarjeta de prueba emite la factura bloqueada", async ({
  page,
}) => {
  test.skip(
    !process.env.E2E_STRIPE_SECRET_KEY,
    "Requiere Stripe en modo test (E2E_STRIPE_SECRET_KEY y stripe listen).",
  );
  const documentId = await draftAtQuota(page);
  await page.goto(`/billing?resume=${documentId}`);
  await page.getByRole("button", { name: "Contratar Esencial" }).click();
  await page.waitForURL(/checkout\.stripe\.com/);
  await page
    .getByLabel(/Número de tarjeta|Card number/)
    .fill("4242424242424242");
  await page.getByLabel(/Caducidad|Expiration/).fill("12 / 34");
  await page.getByLabel(/CVC/).fill("123");
  await page.getByLabel(/NIF|Tax ID/).fill("B12345678");
  await page.getByRole("button", { name: /Suscribirse|Subscribe/ }).click();
  await page.waitForURL(new RegExp(`/documents/${documentId}\\?upgraded=1$`), {
    timeout: 60_000,
  });
  await expect(page.getByText("Emitida", { exact: true })).toBeVisible();
});

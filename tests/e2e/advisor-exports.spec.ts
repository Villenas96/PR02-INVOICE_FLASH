import { expect, type Page, test } from "@playwright/test";

import {
  advisorInviteSeed,
  deriveSignedToken,
} from "../../src/lib/download-tokens";
import { resolvePeriod } from "../../src/lib/exports/period";
import {
  expectAccessible,
  registerVerifyAndSignIn,
  saveFiscalData,
  setCompanyPlan,
  withDatabase,
} from "./helpers";

/** US8 (specs/002, quickstart V8): exports and the advisor's access. */

async function companyIdOf(email: string): Promise<string> {
  return withDatabase(async (database) => {
    const [company] = await database<{ id: string }[]>`
      SELECT company.id FROM company JOIN "user" ON "user".id = company.user_id
      WHERE "user".email = ${email}
    `;
    return company?.id ?? "";
  });
}

/** Issued invoice dated in the previous quarter, as the period export reads. */
async function seedIssuedInvoice(email: string, number: number) {
  const companyId = await companyIdOf(email);
  const quarter = resolvePeriod("previous_quarter", new Date());
  await withDatabase(async (database) => {
    const clientId = crypto.randomUUID();
    await database`
      INSERT INTO client (id, company_id, name, tax_id, address, created_at, updated_at)
      VALUES (${clientId}, ${companyId}, 'Cliente Gestoría', 'A87654321', 'Calle 1', now(), now())
    `;
    await database`
      INSERT INTO document (id, company_id, document_type, status, number, full_number,
        client_id, issue_date, subtotal_cents, tax_breakdown, total_cents,
        client_snapshot, pdf_status, created_at, updated_at)
      VALUES (${crypto.randomUUID()}, ${companyId}, 'invoice', 'issued', ${number},
        ${`2026-${String(number).padStart(4, "0")}`}, ${clientId}, ${quarter.from},
        10000, ${JSON.stringify([{ name: "IVA", rate: "21.00", baseCents: 10000, taxCents: 2100 }])}::jsonb,
        12100, ${JSON.stringify({ name: "Cliente Gestoría", taxId: "A87654321" })}::jsonb,
        'ready', now(), now())
    `;
  });
}

async function ownerWithPlan(page: Page, plan: "essential" | "pro") {
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);
  await setCompanyPlan(email, plan);
  return email;
}

test("Esencial exporta el trimestre anterior y lo envía a su asesoría", async ({
  page,
}) => {
  const email = await ownerWithPlan(page, "essential");
  await seedIssuedInvoice(email, 1);

  await page.goto("/dashboard");
  await page
    .getByRole("navigation", { name: "Principal" })
    .getByRole("link", { name: "Gestoría" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Exportar para mi gestoría" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Exportación avanzada" }),
  ).toHaveCount(0);

  await page.getByLabel("Periodo").selectOption("previous_quarter");
  await page.getByRole("button", { name: "Descargar Excel" }).click();
  const link = page.getByRole("link", { name: /Descargar facturas-.*\.xlsx/ });
  await expect(link).toBeVisible({ timeout: 30_000 });
  const downloadPromise = page.waitForEvent("download");
  await link.click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/\.xlsx$/);

  await page.getByLabel("Email", { exact: true }).fill("asesoria@example.test");
  await page
    .locator("#advisor-email")
    .getByRole("button", { name: "Guardar" })
    .click();
  await expect(page.getByText("Email guardado.")).toBeVisible();
  await page.getByRole("button", { name: "Enviar a mi asesoría" }).click();
  await expect(page.getByText("Enviada a tu asesoría.")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Actualizar" }).click();
  await expect(page.getByText("Enviado a la asesoría").first()).toBeVisible();
  await expectAccessible(page);

  const companyId = await companyIdOf(email);
  const deliveries = await withDatabase(
    (database) => database<{ purpose: string }[]>`
      SELECT purpose::text FROM email_delivery
      WHERE recipient_email = 'asesoria@example.test'
        AND company_id = ${companyId}
    `,
  );
  expect(deliveries).toEqual([{ purpose: "advisor_export" }]);
});

test("la gestoría acepta la invitación, solo consulta y pierde el acceso al retirarlo", async ({
  page,
  browser,
}) => {
  const ownerEmail = await ownerWithPlan(page, "pro");
  await seedIssuedInvoice(ownerEmail, 7);

  const advisorContext = await browser.newContext();
  const advisorPage = await advisorContext.newPage();
  const advisorEmail = await registerVerifyAndSignIn(advisorPage);

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Gestoría" }).click();
  await page.getByLabel("Email de la gestoría").fill(advisorEmail);
  await page.getByRole("button", { name: "Enviar invitación" }).click();
  await expect(page.getByText("Invitación enviada.")).toBeVisible();
  await expect(page.getByText("Invitación pendiente")).toBeVisible();

  const companyId = await companyIdOf(ownerEmail);
  const [access] = await withDatabase(
    (database) => database<{ id: string }[]>`
      SELECT id FROM company_access WHERE company_id = ${companyId}
    `,
  );
  const { token } = await deriveSignedToken(
    process.env.E2E_BETTER_AUTH_SECRET ?? "",
    advisorInviteSeed(access?.id ?? ""),
  );

  await advisorPage.goto(`/advisor/accept?token=${encodeURIComponent(token)}`);
  await advisorPage.getByRole("button", { name: "Aceptar invitación" }).click();
  await expect(advisorPage).toHaveURL(/\/documents$/);
  await expect(advisorPage.getByText("Gestoría · solo lectura")).toBeVisible();
  await expect(advisorPage.getByRole("button", { name: /Nuevo/ })).toHaveCount(
    0,
  );
  await expect(advisorPage.getByText("2026-0007")).toBeVisible();
  await advisorPage.getByRole("link", { name: "2026-0007" }).click();
  await expect(
    advisorPage.getByRole("heading", { name: "2026-0007" }),
  ).toBeVisible();
  await expect(
    advisorPage.getByRole("button", { name: "Anular factura" }),
  ).toHaveCount(0);
  await expect(
    advisorPage.getByRole("button", { name: "Registrar cobro" }),
  ).toHaveCount(0);
  await expectAccessible(advisorPage);

  const write = await advisorPage.request.post("/api/v1/clients", {
    data: { name: "Intento de la gestoría" },
  });
  expect(write.status()).toBe(403);
  expect(await write.json()).toMatchObject({
    error: { code: "read_only_access" },
  });
  await advisorPage.goto("/settings");
  await expect(
    advisorPage.getByRole("heading", { name: "Acceso de solo lectura" }),
  ).toBeVisible();

  await page.reload();
  await page.getByRole("tab", { name: "Gestoría" }).click();
  await expect(page.getByText("Con acceso")).toBeVisible();
  await expect(page.getByText(/Entró a consultar/).first()).toBeVisible();
  await page.getByRole("button", { name: "Retirar acceso" }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByText("Acceso retirado").first()).toBeVisible();

  await advisorPage.goto("/documents");
  await expect(advisorPage.getByText("Gestoría · solo lectura")).toHaveCount(0);
  await expect(advisorPage.getByText("2026-0007")).toHaveCount(0);
  await advisorContext.close();
});

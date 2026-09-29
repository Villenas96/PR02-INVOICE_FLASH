import { stat } from "node:fs/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";

const TEN_MINUTES_MS = 10 * 60 * 1_000;
const TWO_MINUTES_MS = 2 * 60 * 1_000;
const FEEDBACK_DEADLINE_MS = 100;

function e2eDatabaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) {
    throw new Error("E2E_DATABASE_URL es obligatoria para este flujo.");
  }
  return url;
}

async function expectAccessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations).toEqual([]);
}

async function expectResponsive(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
}

async function expectFeedbackWithin(
  action: () => Promise<void>,
  assertion: () => Promise<void>,
): Promise<void> {
  const startedAt = performance.now();
  await action();
  await assertion();
  expect(performance.now() - startedAt).toBeLessThan(FEEDBACK_DEADLINE_MS);
}

async function verificationUrl(email: string): Promise<string> {
  const database = postgres(e2eDatabaseUrl(), { max: 1 });
  try {
    let identifier: string | undefined;
    await expect
      .poll(
        async () => {
          const rows = await database<{ identifier: string }[]>`
            SELECT verification.identifier
            FROM verification
            JOIN email_delivery
              ON email_delivery.auth_verification_id = verification.id
            JOIN "user"
              ON "user".id = email_delivery.user_id
            WHERE "user".email = ${email}
              AND verification.identifier LIKE 'verify-email:%'
            ORDER BY email_delivery.created_at DESC
            LIMIT 1
          `;
          identifier = rows[0]?.identifier;
          return identifier;
        },
        { timeout: 5_000 },
      )
      .toMatch(/^verify-email:/);

    const token = identifier?.slice("verify-email:".length);
    if (!token) {
      throw new Error("No se ha persistido el token de verificación.");
    }
    const url = new URL("/api/auth/verify-email", "http://127.0.0.1:3000");
    url.searchParams.set("token", token);
    url.searchParams.set(
      "callbackURL",
      new URL("/login", url.origin).toString(),
    );
    return url.toString();
  } finally {
    await database.end({ timeout: 5 });
  }
}

async function registerVerifyAndSignIn(page: Page): Promise<string> {
  const suffix = crypto.randomUUID();
  const email = `e2e-${suffix}@example.test`;
  const password = "invoice-flash-e2e-password";

  await page.goto("/register");
  await expectAccessible(page);
  await expectResponsive(page);
  await page.getByLabel("Tu nombre").fill("Usuario E2E");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);

  await page.route("**/api/auth/sign-up/email", async (route) => {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    await route.continue();
  });
  const signUpResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/auth/sign-up/email"),
  );
  const registerButton = page.locator('form button[type="submit"]');
  await expectFeedbackWithin(
    () => registerButton.click(),
    () => expect(registerButton).toHaveText("Procesando…", { timeout: 90 }),
  );
  const signUpResponse = await signUpResponsePromise;
  expect(signUpResponse.status(), await signUpResponse.text()).toBe(200);
  await expect(page.getByText(/Revisa tu correo para verificar/)).toBeVisible();
  await page.unroute("**/api/auth/sign-up/email");

  await page.goto(await verificationUrl(email));
  expect(page.url()).not.toContain("error=");
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/documents$/);
  return email;
}

async function configureCompany(page: Page, email: string): Promise<void> {
  await page.goto("/documents/new");
  await expect(
    page.getByRole("heading", {
      name: "Completa tus datos fiscales para emitir",
    }),
  ).toBeVisible();
  const companyResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/company"),
  );
  const seriesResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/v1/series?"),
  );
  await page.getByRole("link", { name: "Completar configuración" }).click();
  await expect(page).toHaveURL(/\/settings/);
  const [companyResponse, seriesResponse] = await Promise.all([
    companyResponsePromise,
    seriesResponsePromise,
  ]);
  expect(companyResponse.status(), await companyResponse.text()).toBe(200);
  expect(seriesResponse.status(), await seriesResponse.text()).toBe(200);
  await page.getByLabel("Nombre o razón social").fill("Estudio Flash, S.L.");
  await page.getByLabel("NIF, NIE o CIF").fill("B12345678");
  await page
    .getByLabel("Dirección fiscal")
    .fill("Calle de la Prueba 1, 28001 Madrid");
  await page.getByLabel("Correo de facturación").fill(email);

  await page.route("**/api/v1/company", async (route) => {
    if (route.request().method() === "PUT") {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
    await route.continue();
  });
  const saveButton = page.locator(
    'section[aria-labelledby="company-profile-title"] button[type="submit"]',
  );
  await expectFeedbackWithin(
    () => saveButton.click(),
    () => expect(saveButton).toHaveText("Guardando…", { timeout: 90 }),
  );
  await expect(page.getByText("Cambios guardados.")).toBeVisible();
  await page.unroute("**/api/v1/company");
  await expectAccessible(page);
  await expectResponsive(page);
}

async function createClient(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Crear cliente" }).click();
  await page
    .getByLabel("Nombre o razón social")
    .last()
    .fill("Cliente E2E, S.L.");
  await page.getByLabel("NIF, NIE o CIF").last().fill("A87654321");
  await page
    .getByLabel("Dirección fiscal")
    .last()
    .fill("Avenida del Cliente 2, Valencia");
  await page
    .getByRole("button", { name: "Crear cliente", exact: true })
    .last()
    .click();
  await expect(page.getByLabel("Cliente", { exact: true })).toContainText(
    "Cliente E2E",
  );
}

async function fillTwoInvoiceLines(page: Page): Promise<void> {
  const lines = page.getByRole("group", { name: /Línea/ });
  await lines.nth(0).getByLabel("Descripción").fill("Consultoría técnica");
  await lines.nth(0).getByLabel("Cantidad").fill("2");
  await lines.nth(0).getByLabel("Precio unitario").fill("100,00");
  await lines.nth(0).getByLabel("IVA").selectOption("21.00");

  await page.getByRole("button", { name: "Añadir línea" }).click();
  await lines.nth(1).getByLabel("Descripción").fill("Materiales");
  await lines.nth(1).getByLabel("Cantidad").fill("1");
  await lines.nth(1).getByLabel("Precio unitario").fill("50,00");
  await lines.nth(1).getByLabel("IVA").selectOption("10.00");
  await expect(page.getByText("297,00 €")).toBeVisible();
}

async function saveIssueAndDownload(page: Page): Promise<void> {
  await page.route("**/api/v1/documents", async (route) => {
    if (route.request().method() === "POST") {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
    await route.continue();
  });
  const saveButton = page.locator('form button[type="submit"]');
  await expectFeedbackWithin(
    () => saveButton.click(),
    () => expect(saveButton).toHaveText("Guardando borrador…", { timeout: 90 }),
  );
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+$/);
  await page.unroute("**/api/v1/documents");

  await page.route("**/api/v1/documents/*/issue", async (route) => {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    await route.continue();
  });
  const issueButton = page.locator('button[type="button"]').filter({
    hasText: /^(Emitir factura|Emitiendo…)$/,
  });
  await expectFeedbackWithin(
    () => issueButton.click(),
    () => expect(issueButton).toHaveText("Emitiendo…", { timeout: 90 }),
  );
  await expect(page.getByText("Emitida", { exact: true })).toBeVisible();
  await page.unroute("**/api/v1/documents/*/issue");

  await expect(page.getByText("Generando PDF…")).toBeVisible();
  const downloadLink = page.getByRole("link", { name: "Descargar PDF" });
  await expect(downloadLink).toBeVisible({ timeout: 15_000 });
  const downloadPromise = page.waitForEvent("download");
  await downloadLink.click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(download.suggestedFilename()).toMatch(/^factura-.+\.pdf$/);
  expect((await stat(path as string)).size).toBeGreaterThan(1_000);
}

test("registro, configuración y primera factura descargable terminan en menos de diez minutos", async ({
  page,
}) => {
  const startedAt = performance.now();
  const email = await registerVerifyAndSignIn(page);
  await configureCompany(page, email);
  await page.goto("/documents/new");
  await createClient(page);
  await fillTwoInvoiceLines(page);
  await saveIssueAndDownload(page);
  await expectAccessible(page);
  await expectResponsive(page);
  expect(performance.now() - startedAt).toBeLessThan(TEN_MINUTES_MS);
});

test("un usuario configurado crea y descarga otra factura en menos de dos minutos", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);
  await configureCompany(page, email);

  const startedAt = performance.now();
  await page.goto("/documents/new");
  await createClient(page);
  await fillTwoInvoiceLines(page);
  await saveIssueAndDownload(page);
  expect(performance.now() - startedAt).toBeLessThan(TWO_MINUTES_MS);
});

test("los borradores incompletos muestran errores accionables y no se emiten", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);
  await configureCompany(page, email);
  await page.goto("/documents/new");

  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(
    /revisa|descripción/i,
  );

  const firstLine = page.getByRole("group", { name: "Línea 1" });
  await firstLine.getByLabel("Descripción").fill("Borrador sin cliente");
  const createResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/v1/documents"),
  );
  const detailResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      /\/api\/v1\/documents\/[0-9a-f-]+$/.test(response.url()),
  );
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status(), await createResponse.text()).toBe(201);
  const created = (await createResponse.json()) as { id: string };
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+$/);
  expect(new URL(page.url()).pathname).toBe(`/documents/${created.id}`);
  const detailResponse = await detailResponsePromise;
  expect(detailResponse.status(), await detailResponse.text()).toBe(200);
  await page.getByRole("button", { name: "Emitir factura" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(/cliente/i);
  await expect(page.getByText("Borrador", { exact: true })).toBeVisible();
  await expectAccessible(page);
  await expectResponsive(page);
});

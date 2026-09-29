import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";

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
  const email = `e2e-clients-${suffix}@example.test`;
  const password = "invoice-flash-e2e-password";

  await page.goto("/register");
  await page.getByLabel("Tu nombre").fill("Usuario Clientes");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  const signUpResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/auth/sign-up/email"),
  );
  await page.locator('form button[type="submit"]').click();
  const signUpResponse = await signUpResponsePromise;
  expect(signUpResponse.status(), await signUpResponse.text()).toBe(200);

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
  const response = await page.request.put("/api/v1/company", {
    data: {
      legal_name: "Estudio Clientes, S.L.",
      tax_id: "B12345678",
      address: "Calle de los Clientes 1, 28001 Madrid",
      email,
    },
  });
  expect(response.status(), await response.text()).toBe(200);
}

test("crea, busca, factura, edita y archiva un cliente sin alterar el documento emitido", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);
  await configureCompany(page, email);
  // Mirrors the editor's own load, which bootstraps the default invoice
  // series the first time it is requested (`ensureInvoiceSeries`).
  await page.request.get("/api/v1/series?doc_type=invoice");

  await page.goto("/clients");
  await expectAccessible(page);
  await expectResponsive(page);

  await page.getByRole("button", { name: "Nuevo cliente" }).click();
  await page.getByLabel("Nombre o razón social").fill("Cliente E2E Clientes");
  await page.getByLabel("NIF, NIE o CIF").fill("A87654321");
  await page
    .getByLabel("Dirección fiscal")
    .fill("Avenida del Cliente 9, Valencia");
  await page
    .getByRole("button", { name: "Crear cliente", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Cliente E2E Clientes" }),
  ).toBeVisible();

  await page.getByLabel("Buscar").fill("E2E Clientes");
  await expect(
    page.getByRole("link", { name: "Cliente E2E Clientes" }),
  ).toBeVisible();
  await page.getByLabel("Buscar").fill("ningún resultado posible");
  await expect(
    page.getByText("No hay clientes con estos filtros"),
  ).toBeVisible();
  await page.getByLabel("Buscar").fill("");

  await page.goto("/documents/new");
  await page.getByLabel("Buscar cliente").fill("E2E Clientes");
  await expect(
    page.getByLabel("Cliente", { exact: true }).locator("option"),
  ).toHaveCount(2);
  await page
    .getByLabel("Cliente", { exact: true })
    .selectOption({ label: "Cliente E2E Clientes · A87654321" });
  const firstLine = page.getByRole("group", { name: "Línea 1" });
  await firstLine.getByLabel("Descripción").fill("Servicio de prueba");
  await firstLine.getByLabel("Cantidad").fill("1");
  await firstLine.getByLabel("Precio unitario").fill("200,00");
  await firstLine.getByLabel("IVA").selectOption("21.00");

  await page.route("**/api/v1/documents", async (route) => {
    if (route.request().method() === "POST") {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+$/);
  await page.unroute("**/api/v1/documents");

  await page.route("**/api/v1/documents/*/issue", async (route) => {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    await route.continue();
  });
  await page.getByRole("button", { name: "Emitir factura" }).click();
  await expect(page.getByText("Emitida", { exact: true })).toBeVisible();
  await page.unroute("**/api/v1/documents/*/issue");
  const documentUrl = page.url();

  await page.getByRole("link", { name: "Cliente E2E Clientes" }).click();
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]+$/);
  await expect(page.getByTestId("client-pending-total")).toHaveText("242,00 €");
  await expect(page.getByRole("link", { name: "2026-0001" })).toBeVisible();

  await page.getByRole("button", { name: "Editar" }).click();
  await page.getByLabel("Nombre o razón social").fill("Cliente E2E Renombrado");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(
    page.getByRole("heading", { name: "Cliente E2E Renombrado" }),
  ).toBeVisible();

  await page.goto(documentUrl);
  await expect(page.getByText("Cliente E2E Clientes")).toBeVisible();

  await page.goto("/clients");
  await expect(
    page.getByRole("link", { name: "Cliente E2E Renombrado" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Cliente E2E Renombrado" }).click();
  await page.getByRole("button", { name: "Archivar cliente" }).click();
  await expect(page.getByText("Archivado")).toBeVisible();

  await page.goto("/documents/new");
  await page.getByLabel("Buscar cliente").fill("E2E Renombrado");
  await expect(
    page.getByLabel("Cliente", { exact: true }).locator("option"),
  ).toHaveCount(1);
});

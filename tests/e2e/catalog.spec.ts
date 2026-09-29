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
  const email = `e2e-catalog-${suffix}@example.test`;
  const password = "invoice-flash-e2e-password";

  await page.goto("/register");
  await page.getByLabel("Tu nombre").fill("Usuario Catálogo");
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
      legal_name: "Estudio Catálogo, S.L.",
      tax_id: "B12345678",
      address: "Calle del Catálogo 1, 28001 Madrid",
      email,
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  // Mirrors the editor's own load, which bootstraps the default invoice
  // series the first time it is requested (`ensureInvoiceSeries`).
  await page.request.get("/api/v1/series?doc_type=invoice");
}

test("copia un concepto del catálogo en una línea sin acoplar el documento a ediciones o archivado posteriores", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);
  await configureCompany(page, email);

  await page.goto("/catalog");
  await expectAccessible(page);
  await expectResponsive(page);

  await page.getByRole("button", { name: "Nuevo concepto" }).click();
  await page.getByLabel("Descripción").fill("Hora de consultoría E2E");
  await page.getByLabel("Precio unitario").fill("60,00");
  await page
    .getByRole("button", { name: "Crear concepto", exact: true })
    .click();
  await expect(page.getByText("Hora de consultoría E2E")).toBeVisible();

  const clientResponse = await page.request.post("/api/v1/clients", {
    data: { name: "Cliente Catálogo E2E" },
  });
  expect(clientResponse.status(), await clientResponse.text()).toBe(201);

  await page.goto("/documents/new");
  await page.getByLabel("Buscar cliente").fill("Cliente Catálogo E2E");
  await page
    .getByLabel("Cliente", { exact: true })
    .selectOption({ label: "Cliente Catálogo E2E" });
  await page.getByRole("button", { name: "Añadir desde catálogo" }).click();
  await page.getByRole("button", { name: /Hora de consultoría E2E/ }).click();
  const catalogLine = page.getByRole("group", { name: "Línea 2" });
  await expect(catalogLine.getByLabel("Descripción")).toHaveValue(
    "Hora de consultoría E2E",
  );
  await expect(catalogLine.getByLabel("Precio unitario")).toHaveValue("60,00");
  await page
    .getByRole("group", { name: "Línea 1" })
    .getByRole("button", { name: "Quitar" })
    .click();

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

  await page.goto("/catalog");
  await page.getByRole("button", { name: "Editar" }).click();
  await page.getByLabel("Precio unitario").fill("90,00");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("90,00 €")).toBeVisible();

  await page.goto(documentUrl);
  await expect(page.getByText("60,00 €").first()).toBeVisible();
  await expect(page.getByText("90,00 €")).toHaveCount(0);

  await page.goto("/catalog");
  await page.getByRole("button", { name: "Archivar" }).click();
  await expect(page.getByText("Archivado")).toBeVisible();

  await page.goto("/documents/new");
  await page.getByRole("button", { name: "Añadir desde catálogo" }).click();
  await page.getByLabel("Buscar concepto").fill("Hora de consultoría E2E");
  await expect(
    page.getByText("No hay conceptos con esta búsqueda."),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/catalog");
  await page.getByLabel("Mostrar archivados").check();
  await page.getByRole("button", { name: "Restaurar" }).click();
  await expect(
    page.getByText("No hay conceptos con estos filtros"),
  ).toBeVisible();
  await page.getByLabel("Mostrar archivados").uncheck();
  await expect(page.getByText("Hora de consultoría E2E")).toBeVisible();
  await expect(page.getByText("Activo")).toBeVisible();
});

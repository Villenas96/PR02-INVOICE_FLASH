import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import postgres from "postgres";

/**
 * Shared flows for the v2 (specs/002) E2E suites. The v1 specs keep their own
 * copies; new specs import from here.
 */

export function e2eDatabaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) {
    throw new Error("E2E_DATABASE_URL es obligatoria para este flujo.");
  }
  return url;
}

export async function withDatabase<T>(
  action: (database: postgres.Sql) => Promise<T>,
): Promise<T> {
  const database = postgres(e2eDatabaseUrl(), { max: 1 });
  try {
    return await action(database);
  } finally {
    await database.end({ timeout: 5 });
  }
}

export async function expectAccessible(page: Page): Promise<void> {
  await page.addStyleTag({
    content:
      "*, *::before, *::after { transition: none !important; animation: none !important; }",
  });
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations).toEqual([]);
}

export async function expectResponsive(page: Page): Promise<void> {
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

/**
 * Marks the current document so a later `expectNoReload` proves the UI
 * updated through client navigation/refresh, never a full page reload.
 */
export async function markPage(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __noReload?: boolean }).__noReload = true;
  });
}

export async function expectNoReload(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () => (window as unknown as { __noReload?: boolean }).__noReload === true,
    ),
  ).toBe(true);
}

async function verificationUrl(email: string): Promise<string> {
  return withDatabase(async (database) => {
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
  });
}

export async function registerVerifyAndSignIn(page: Page): Promise<string> {
  const email = `e2e-${crypto.randomUUID()}@example.test`;
  const password = "invoice-flash-e2e-password";

  await page.goto("/register");
  await page.getByLabel("Tu nombre").fill("Usuario E2E");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByText(/Revisa tu correo para verificar/)).toBeVisible();

  await page.goto(await verificationUrl(email));
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/documents$/);
  return email;
}

/** Saves complete fiscal data from the settings page. */
export async function saveFiscalData(page: Page, email: string): Promise<void> {
  await page.getByLabel("Nombre o razón social").fill("Estudio Flash, S.L.");
  await page.getByLabel("NIF, NIE o CIF").fill("B12345678");
  await page
    .getByLabel("Dirección fiscal")
    .fill("Calle de la Prueba 1, 28001 Madrid");
  await page.getByLabel("Correo de facturación").fill(email);
  await page
    .locator(
      'section[aria-labelledby="company-profile-title"] button[type="submit"]',
    )
    .click();
  await expect(page.getByText("Cambios guardados.")).toBeVisible();
}

export async function setCompanyPlan(
  email: string,
  plan: "basic" | "essential" | "pro",
): Promise<void> {
  await withDatabase(async (database) => {
    await database`
      UPDATE company SET plan = ${plan}
      WHERE user_id = (SELECT id FROM "user" WHERE email = ${email})
    `;
  });
}

/** Creates a client from the editor's inline dialog. */
export async function createClientInEditor(
  page: Page,
  name = "Cliente E2E, S.L.",
  taxId = "A87654321",
): Promise<void> {
  await page.getByRole("button", { name: "Crear cliente" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nombre o razón social").fill(name);
  await dialog.getByLabel("NIF, NIE o CIF").fill(taxId);
  await dialog
    .getByLabel("Dirección fiscal")
    .fill("Avenida del Cliente 2, Valencia");
  await dialog
    .getByRole("button", { name: "Crear cliente", exact: true })
    .click();
  await expect(dialog).toBeHidden();
}

export async function fillFirstLine(
  page: Page,
  description = "Consultoría técnica",
  price = "100,00",
): Promise<void> {
  const line = page.getByRole("group", { name: "Línea 1" });
  await line.getByLabel("Descripción").fill(description);
  await line.getByLabel("Cantidad").fill("1");
  await line.getByLabel("Precio unitario").fill(price);
}

/** Searches the editor's client combobox and picks the matching client. */
export async function selectClientInEditor(
  page: Page,
  query: string,
  optionName: RegExp,
): Promise<void> {
  await page.getByRole("combobox", { name: "Cliente" }).click();
  await page.keyboard.type(query);
  await page.getByRole("option", { name: optionName }).click();
  await expect(page.getByRole("combobox", { name: "Cliente" })).toContainText(
    query,
  );
}

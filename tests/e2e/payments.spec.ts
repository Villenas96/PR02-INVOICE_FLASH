import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";

const TEN_SECONDS_MS = 10_000;

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
  const email = `e2e-payments-${suffix}@example.test`;
  const password = "invoice-flash-e2e-password";

  await page.goto("/register");
  await page.getByLabel("Tu nombre").fill("Usuario Cobros");
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
      legal_name: "Estudio Cobros, S.L.",
      tax_id: "B12345678",
      address: "Calle de los Cobros 1, 28001 Madrid",
      email,
    },
  });
  expect(response.status(), await response.text()).toBe(200);
}

async function createClient(page: Page): Promise<string> {
  const response = await page.request.post("/api/v1/clients", {
    data: { name: "Cliente Cobros, S.L." },
  });
  expect(response.status(), await response.text()).toBe(201);
  const body = (await response.json()) as { id: string };
  return body.id;
}

async function createIssuedInvoice(
  page: Page,
  options: { clientId: string; totalUnitPriceCents: number; dueDate?: string },
): Promise<string> {
  const createResponse = await page.request.post("/api/v1/documents", {
    data: {
      doc_type: "invoice",
      client_id: options.clientId,
      due_date: options.dueDate,
      lines: [
        {
          description: "Servicio de cobros",
          quantity: "1",
          unit_price_cents: options.totalUnitPriceCents,
          tax_rate: "0",
        },
      ],
    },
  });
  expect(createResponse.status(), await createResponse.text()).toBe(201);
  const created = (await createResponse.json()) as { id: string };

  const issueResponse = await page.request.post(
    `/api/v1/documents/${created.id}/issue`,
  );
  expect(issueResponse.status(), await issueResponse.text()).toBe(200);
  return created.id;
}

async function payInvoice(
  page: Page,
  documentId: string,
  amountCents: number,
): Promise<void> {
  const response = await page.request.post(
    `/api/v1/documents/${documentId}/payments`,
    { data: { amount_cents: amountCents, paid_on: "2026-01-15" } },
  );
  expect(response.status(), await response.text()).toBe(201);
}

test("el panel de cobros identifica pendiente, pagada, parcial y vencida en menos de diez segundos", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);
  await configureCompany(page, email);
  const clientId = await createClient(page);
  // Mirrors the editor's own load, which bootstraps the default invoice
  // series the first time it is requested (`ensureInvoiceSeries`).
  await page.request.get("/api/v1/series?doc_type=invoice");

  await createIssuedInvoice(page, { clientId, totalUnitPriceCents: 11_100 });
  await createIssuedInvoice(page, {
    clientId,
    totalUnitPriceCents: 22_200,
    dueDate: "2020-01-01",
  });
  const partialId = await createIssuedInvoice(page, {
    clientId,
    totalUnitPriceCents: 77_700,
  });
  await payInvoice(page, partialId, 30_000);
  const paidId = await createIssuedInvoice(page, {
    clientId,
    totalUnitPriceCents: 44_400,
  });
  await payInvoice(page, paidId, 44_400);

  const startedAt = performance.now();
  await page.goto("/dashboard");
  await expect(page.getByTestId("dashboard-paid-total")).toHaveText("744,00 €");
  await expect(page.getByTestId("dashboard-pending-total")).toHaveText(
    "588,00 €",
  );
  await expect(page.getByTestId("dashboard-overdue-total")).toHaveText(
    "222,00 €",
  );

  const rows = page.locator("tbody").getByRole("row");
  await expect(rows.filter({ hasText: "Pendiente" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "Vencida" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "Parcial" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "Pagada" })).toHaveCount(1);
  expect(performance.now() - startedAt).toBeLessThan(TEN_SECONDS_MS);
  await expectAccessible(page);

  await page.getByLabel("Estado de cobro").selectOption({ label: "Vencida" });
  await expect(rows.filter({ hasText: "Vencida" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "Pendiente" })).toHaveCount(0);
  await page.getByLabel("Estado de cobro").selectOption({ label: "Todos" });

  await rows.filter({ hasText: "Parcial" }).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(partialId));
  await expect(page.getByText("Parcialmente pagada")).toBeVisible();
  await expect(page.getByText("Pendiente 477,00 €")).toBeVisible();

  await page.getByRole("button", { name: "Editar" }).click();
  await page.getByLabel("Importe cobrado").fill("777");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Pagada", { exact: true })).toBeVisible();
  await expect(page.getByText("Pendiente 0,00 €")).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByTestId("dashboard-paid-total")).toHaveText(
    "1.221,00 €",
  );
  await expect(page.getByTestId("dashboard-pending-total")).toHaveText(
    "111,00 €",
  );
});

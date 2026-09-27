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
  const email = `e2e-share-${suffix}@example.test`;
  const password = "invoice-flash-e2e-password";

  await page.goto("/register");
  await page.getByLabel("Tu nombre").fill("Usuario Comparte");
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

async function configureCompanyAndIssueInvoice(
  page: Page,
  email: string,
): Promise<string> {
  const companyResponse = await page.request.put("/api/v1/company", {
    data: {
      legal_name: "Estudio Comparte, S.L.",
      tax_id: "B12345678",
      address: "Calle de Comparte 1, 28001 Madrid",
      email,
    },
  });
  expect(companyResponse.status(), await companyResponse.text()).toBe(200);
  await page.request.get("/api/v1/series?doc_type=invoice");

  const clientResponse = await page.request.post("/api/v1/clients", {
    data: { name: "Cliente Comparte" },
  });
  expect(clientResponse.status()).toBe(201);
  const client = (await clientResponse.json()) as { id: string };

  const createResponse = await page.request.post("/api/v1/documents", {
    data: {
      doc_type: "invoice",
      client_id: client.id,
      lines: [
        {
          description: "Servicio compartido",
          quantity: "1",
          unit_price_cents: 10_000,
          tax_rate: "21.00",
        },
      ],
    },
  });
  expect(createResponse.status()).toBe(201);
  const created = (await createResponse.json()) as { id: string };

  const issueResponse = await page.request.post(
    `/api/v1/documents/${created.id}/issue`,
  );
  expect(issueResponse.status(), await issueResponse.text()).toBe(200);
  return created.id;
}

test("un enlace público se ve al primer intento sin cuenta, se puede desactivar y muestra el estado anulado", async ({
  page,
  browser,
}) => {
  const email = await registerVerifyAndSignIn(page);
  const documentId = await configureCompanyAndIssueInvoice(page, email);

  await page.goto(`/documents/${documentId}`);
  await expect(page.getByText("Generando PDF…")).toBeVisible();

  await page.getByRole("button", { name: "Generar enlace público" }).click();
  const shareUrlInput = page.locator("input[readonly]");
  await expect(shareUrlInput).toHaveValue(/\/d\//);
  const shareUrl = await shareUrlInput.inputValue();

  const anonymousContext = await browser.newContext();
  const anonymousPage = await anonymousContext.newPage();
  await anonymousPage.goto(shareUrl);
  await expect(anonymousPage.getByText("2026-0001")).toBeVisible();
  await expectAccessible(anonymousPage);
  await expectResponsive(anonymousPage);

  // The render queue is asynchronous by design (FR contract): the public PDF
  // link must answer either "processing" (202, with Retry-After) or the
  // final PDF (200) — never render synchronously and never error.
  const pdfResponse = await anonymousPage.request.get(`${shareUrl}/pdf`);
  expect([200, 202]).toContain(pdfResponse.status());
  if (pdfResponse.status() === 200) {
    expect(pdfResponse.headers()["content-type"]).toBe("application/pdf");
  } else {
    expect(pdfResponse.headers()["retry-after"]).toBeTruthy();
  }

  await page.getByRole("button", { name: "Desactivar enlace" }).click();
  await expect(page.getByText("Desactivado")).toBeVisible();

  const disabledResponse = await anonymousPage.goto(shareUrl);
  expect(disabledResponse?.status()).toBe(404);

  await anonymousContext.close();
});

test("un documento anulado sigue siendo visible por su enlace, marcado como anulado", async ({
  page,
  browser,
}) => {
  const email = await registerVerifyAndSignIn(page);
  const documentId = await configureCompanyAndIssueInvoice(page, email);

  await page.goto(`/documents/${documentId}`);
  await page.getByRole("button", { name: "Generar enlace público" }).click();
  const shareUrl = await page.locator("input[readonly]").inputValue();

  await page.getByRole("button", { name: "Anular factura" }).click();
  await page.getByRole("button", { name: "Confirmar anulación" }).click();
  await expect(page.getByText("Anulada", { exact: true })).toBeVisible();

  const anonymousContext = await browser.newContext();
  const anonymousPage = await anonymousContext.newPage();
  await anonymousPage.goto(shareUrl);
  await expect(
    anonymousPage.getByText("Este documento ha sido anulado."),
  ).toBeVisible();
  await expectAccessible(anonymousPage);

  await anonymousContext.close();
});

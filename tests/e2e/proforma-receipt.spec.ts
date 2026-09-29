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

async function registerVerifyAndSignIn(
  page: Page,
  suffix: string,
): Promise<string> {
  const email = `e2e-proforma-receipt-${suffix}@example.test`;
  const password = "invoice-flash-e2e-password";

  await page.goto("/register");
  await page.getByLabel("Tu nombre").fill("Usuario Proforma");
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

async function configureCompanyAndClient(
  page: Page,
  email: string,
): Promise<string> {
  const companyResponse = await page.request.put("/api/v1/company", {
    data: {
      legal_name: "Estudio Proforma, S.L.",
      tax_id: "B12345678",
      address: "Calle de la Proforma 1, 28001 Madrid",
      email,
    },
  });
  expect(companyResponse.status(), await companyResponse.text()).toBe(200);
  // Default series are bootstrapped lazily by the editor's own series
  // requests; an API-only flow must trigger it explicitly before issuing.
  await page.request.get("/api/v1/series?doc_type=invoice");
  await page.request.get("/api/v1/series?doc_type=proforma");

  const clientResponse = await page.request.post("/api/v1/clients", {
    data: { name: "Cliente Proforma, S.L." },
  });
  expect(clientResponse.status(), await clientResponse.text()).toBe(201);
  const client = (await clientResponse.json()) as { id: string };
  return client.id;
}

async function createIssuedProforma(
  page: Page,
  clientId: string,
  unitPriceCents = 10_000,
): Promise<string> {
  const createResponse = await page.request.post("/api/v1/documents", {
    data: {
      doc_type: "proforma",
      client_id: clientId,
      lines: [
        {
          description: "Servicio de consultoría",
          quantity: "1",
          unit_price_cents: unitPriceCents,
          tax_rate: "21.00",
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

async function createIssuedInvoice(
  page: Page,
  clientId: string,
): Promise<string> {
  const createResponse = await page.request.post("/api/v1/documents", {
    data: {
      doc_type: "invoice",
      client_id: clientId,
      lines: [
        {
          description: "Servicio de relleno",
          quantity: "1",
          unit_price_cents: 1_000,
          tax_rate: "21.00",
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

test("convierte una proforma en factura, genera un recibo único por pago y permite duplicar, pero no recibos", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page, crypto.randomUUID());
  const clientId = await configureCompanyAndClient(page, email);
  const proformaId = await createIssuedProforma(page, clientId, 10_000);

  await page.goto(`/documents/${proformaId}`);
  await expect(page.getByText("Proforma", { exact: true })).toBeVisible();
  await expect(page.getByText("Emitida", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Acciones" })).toBeVisible();
  await expectAccessible(page);

  const convertButton = page.getByRole("button", {
    name: "Convertir y emitir factura",
  });
  await expect(convertButton).toBeVisible();
  await convertButton.click();
  await page.waitForURL((url) => url.pathname !== `/documents/${proformaId}`);
  const invoiceUrl = page.url();
  const invoiceId = invoiceUrl.split("/").at(-1);
  expect(invoiceId).not.toBe(proformaId);

  await expect(page.getByText("Factura", { exact: true })).toBeVisible();
  await expect(page.getByText("Emitida", { exact: true })).toBeVisible();
  const invoiceFullNumberText = await page
    .locator("h1")
    .filter({ hasText: /^\d{4}-\d{4}$/ })
    .textContent();
  expect(invoiceFullNumberText).toMatch(/^\d{4}-\d{4}$/);
  await expect(page.getByText("121,00 €").first()).toBeVisible();

  // The proforma must now show it is linked to the freshly created invoice.
  await page.goto(`/documents/${proformaId}`);
  await expect(
    page.getByText("Esta proforma ya se convirtió en factura."),
  ).toBeVisible();
  await page.getByRole("link", { name: "Ver factura" }).click();
  await expect(page).toHaveURL(new RegExp(`/documents/${invoiceId}$`));

  // Register a partial payment directly (the payments UI itself is covered
  // elsewhere) to reach the receipt-generation action under test here.
  const paymentResponse = await page.request.post(
    `/api/v1/documents/${invoiceId}/payments`,
    { data: { amount_cents: 50_00, paid_on: "2026-01-15" } },
  );
  expect(paymentResponse.status(), await paymentResponse.text()).toBe(201);
  await page.reload();

  await expect(page.getByRole("heading", { name: "Recibos" })).toBeVisible();
  const generateReceiptButton = page.getByRole("button", {
    name: "Generar recibo",
  });
  await expect(generateReceiptButton).toBeVisible();
  await generateReceiptButton.click();
  await page.waitForURL((url) => url.pathname !== `/documents/${invoiceId}`);
  const receiptUrl = page.url();
  const receiptId = receiptUrl.split("/").at(-1);
  expect(receiptId).not.toBe(invoiceId);

  await expect(
    page.getByRole("heading", { name: "Recibo", exact: true }),
  ).toBeVisible();
  const receiptFullNumberText = await page
    .locator("h1")
    .filter({ hasText: /^REC-\d{4}-\d{4}$/ })
    .textContent();
  expect(receiptFullNumberText).toMatch(/^REC-\d{4}-\d{4}$/);
  await expect(page.getByText("Importe cobrado")).toBeVisible();
  await expect(page.getByText("50,00 €")).toBeVisible();
  await expect(page.getByRole("button", { name: /Duplicar/ })).toHaveCount(0);
  await expectAccessible(page);

  // The public PDF pipeline is asynchronous by contract: it must answer
  // either "ready" (200) or "processing" (202), never error.
  const pdfResponse = await page.request.get(
    `/api/v1/documents/${receiptId}/pdf`,
  );
  expect([200, 202]).toContain(pdfResponse.status());

  // Generating a receipt for the same payment again must resolve to the
  // exact same document — no new number, PDF or quota consumption.
  await page.getByRole("link", { name: "Ver factura" }).click();
  await expect(page).toHaveURL(new RegExp(`/documents/${invoiceId}$`));
  await page.getByRole("button", { name: "Generar recibo" }).click();
  await expect(page).toHaveURL(new RegExp(`/documents/${receiptId}$`));

  // Invoices (and proformas) can be duplicated to a fresh, numberless draft.
  await page.goto(`/documents/${invoiceId}`);
  await page
    .getByRole("button", { name: "Duplicar como nuevo borrador" })
    .click();
  await page.waitForURL((url) => url.pathname !== `/documents/${invoiceId}`);
  const duplicateUrl = page.url();
  expect(duplicateUrl).not.toContain(invoiceId as string);
  await expect(page.getByText("Borrador", { exact: true })).toBeVisible();
  await expect(page.getByText("Factura", { exact: true })).toBeVisible();
});

test("al agotar el cupo mensual, convertir y emitir ofrece guardar la conversión como borrador", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page, crypto.randomUUID());
  const clientId = await configureCompanyAndClient(page, email);

  // Four issued invoices plus the proforma issued below hit the free plan's
  // five-document monthly limit, shared across every document type.
  for (let index = 0; index < 4; index += 1) {
    await createIssuedInvoice(page, clientId);
  }
  const proformaId = await createIssuedProforma(page, clientId, 20_000);

  await page.goto(`/documents/${proformaId}`);

  // The exhausted-quota state is shown proactively (matching the existing
  // conventional-issue action), so the direct-issue button is disabled
  // rather than failing only after a click.
  const convertButton = page.getByRole("button", {
    name: "Convertir y emitir factura",
  });
  await expect(convertButton).toBeDisabled();
  await expect(
    page.getByText(/Has alcanzado el límite de 5 emisiones de este mes/),
  ).toBeVisible();
  await expectAccessible(page);

  const saveAsDraftButton = page.getByRole("button", {
    name: "Guardar como borrador",
  });
  await expect(saveAsDraftButton).toBeVisible();
  await saveAsDraftButton.click();
  await page.waitForURL((url) => url.pathname !== `/documents/${proformaId}`);
  expect(page.url()).not.toContain(proformaId);
  await expect(page.getByText("Borrador", { exact: true })).toBeVisible();
  await expect(page.getByText("Factura", { exact: true })).toBeVisible();
});

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";

import {
  registerVerifyAndSignIn,
  saveFiscalData,
  setCompanyPlan,
  withDatabase,
} from "./helpers";

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

/** Registers and verifies an account without ever signing in, so the main
 * test page stays a genuinely logged-out browser for the /login checks. */
async function registerAndVerifyOnly(
  page: Page,
): Promise<{ email: string; password: string }> {
  const suffix = crypto.randomUUID();
  const email = `e2e-a11y-${suffix}@example.test`;
  const password = "invoice-flash-e2e-password";

  const signUpResponse = await page.request.post("/api/auth/sign-up/email", {
    data: { name: "Usuario Accesibilidad", email, password },
  });
  expect(signUpResponse.status(), await signUpResponse.text()).toBe(200);
  await page.goto(await verificationUrl(email));

  return { email, password };
}

test("login, documents, settings and client detail pages are accessible, responsive and give fast feedback under a delayed network", async ({
  page,
  browser,
}) => {
  const setupContext = await browser.newContext();
  const setupPage = await setupContext.newPage();
  const { email, password } = await registerAndVerifyOnly(setupPage);
  await setupContext.close();

  // The main `page` never had a session cookie set, so /login renders the
  // genuine logged-out form.
  await page.goto("/login");
  await expectAccessible(page);
  await expectResponsive(page);

  await page.route("**/api/auth/sign-in/email", async (route) => {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    await route.continue();
  });
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  const loginButton = page.locator('form button[type="submit"]');
  await expectFeedbackWithin(
    () => loginButton.click(),
    () => expect(loginButton).toHaveText("Procesando…", { timeout: 90 }),
  );
  await expect(page).toHaveURL(/\/documents$/);
  await page.unroute("**/api/auth/sign-in/email");

  const companyResponse = await page.request.put("/api/v1/company", {
    data: {
      legal_name: "Estudio Accesibilidad, S.L.",
      tax_id: "B12345678",
      address: "Calle de la Accesibilidad 1, 28001 Madrid",
      email,
    },
  });
  expect(companyResponse.status(), await companyResponse.text()).toBe(200);

  // The plain documents list, in its empty state, still needs to be fully
  // accessible and responsive before any document exists.
  await page.goto("/documents");
  await expect(
    page.getByRole("heading", { name: "Todavía no hay documentos" }),
  ).toBeVisible();
  await expectAccessible(page);
  await expectResponsive(page);

  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Tu negocio, listo para facturar" }),
  ).toBeVisible();
  await expectAccessible(page);
  await expectResponsive(page);

  const clientResponse = await page.request.post("/api/v1/clients", {
    data: {
      name: "Cliente Accesibilidad, S.L.",
      // Issuing an invoice requires the client's tax id and address.
      tax_id: "A87654321",
      address: "Avenida del Cliente 2, 46001 Valencia",
    },
  });
  expect(clientResponse.status(), await clientResponse.text()).toBe(201);
  const client = (await clientResponse.json()) as { id: string };

  await page.goto(`/clients/${client.id}`);
  await expect(
    page.getByRole("heading", { name: "Cliente Accesibilidad, S.L." }),
  ).toBeVisible();
  await expectAccessible(page);
  await expectResponsive(page);

  await page.route("**/api/v1/clients/*/archive", async (route) => {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    await route.continue();
  });
  const archiveButton = page
    .getByRole("button")
    .filter({ hasText: /^(Archivar cliente|Guardando…)$/ });
  await expectFeedbackWithin(
    () => archiveButton.click(),
    () => expect(archiveButton).toHaveText("Guardando…", { timeout: 90 }),
  );
  await expect(page.getByText("Archivado")).toBeVisible();
  await page.unroute("**/api/v1/clients/*/archive");
  // The archive/restore button's colors animate (`transition-all`) between
  // its destructive and outline variants; wait for that transition to
  // settle before judging contrast, or axe can catch a mid-transition frame.
  await page.waitForTimeout(300);
  await expectAccessible(page);
});

/** Every page added by v2 (US1–US15), reachable by a Pro account. */
const V2_PAGES = [
  "/dashboard",
  "/documents",
  "/documents/new?type=quote",
  "/clients",
  "/catalog",
  "/catalog/import",
  "/exports",
  "/recurring",
  "/recurring/new",
  "/reconciliation",
  "/onboarding",
  "/billing",
  "/settings",
];

test("every v2 page is accessible and responsive", async ({ page }) => {
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);
  await setCompanyPlan(email, "pro");

  for (const path of V2_PAGES) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await page.addStyleTag({
      content:
        "*, *::before, *::after { transition: none !important; animation: none !important; }",
    });
    await expectAccessible(page);
    await expectResponsive(page);
  }

  // Settings sections that only exist as tabs of the full interface.
  await page.goto("/settings");
  for (const tab of [
    "Cobros e impuestos",
    "Gestoría",
    "Asistentes de IA",
    "Suscripción",
  ]) {
    await page.getByRole("tab", { name: tab }).click();
    await expectAccessible(page);
    await expectResponsive(page);
  }
});

test("v2 mutations give visible feedback within 100 ms under a delayed network", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);
  await setCompanyPlan(email, "pro");
  const slow = (pattern: string) =>
    page.route(pattern, async (route) => {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 400));
      // The page may have moved on (and handled the route) meanwhile.
      await route.continue().catch(() => undefined);
    });

  // Export.
  await page.goto("/exports");
  await slow("**/api/v1/exports");
  const exportButton = page.getByRole("button", { name: "Descargar Excel" });
  await expectFeedbackWithin(
    () => exportButton.click(),
    () => expect(exportButton).toBeDisabled({ timeout: 90 }),
  );
  await page.unroute("**/api/v1/exports");

  // Import (catalog CSV upload).
  await page.goto("/catalog/import");
  await page
    .getByLabel("Archivo CSV")
    .setInputFiles("tests/fixtures/csv/catalog-500.csv");
  await slow("**/api/v1/imports");
  const analyze = page
    .getByRole("button")
    .filter({ hasText: /^(Analizar archivo|Subiendo…)$/ });
  await expectFeedbackWithin(
    () => analyze.click(),
    () => expect(analyze).toHaveText("Subiendo…", { timeout: 90 }),
  );
  await page.unroute("**/api/v1/imports");

  // Advisor invitation.
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Gestoría" }).click();
  await page.getByLabel("Email de la gestoría").fill("gestoria@example.test");
  await slow("**/api/v1/advisor-access");
  const invite = page
    .getByRole("button")
    .filter({ hasText: /^(Enviar invitación|Enviando…)$/ });
  await expectFeedbackWithin(
    () => invite.click(),
    () => expect(invite).toHaveText("Enviando…", { timeout: 90 }),
  );
  await page.unroute("**/api/v1/advisor-access");

  // Quote → delivery note conversion.
  const client = await page.request.post("/api/v1/clients", {
    data: {
      name: "Cliente Feedback, S.L.",
      tax_id: "A87654321",
      address: "Calle del Cliente 2, 46001 Valencia",
    },
  });
  const { id: clientId } = (await client.json()) as { id: string };
  const draft = await page.request.post("/api/v1/documents", {
    data: {
      doc_type: "quote",
      client_id: clientId,
      lines: [
        {
          description: "Servicio",
          quantity: 1,
          unit_price_cents: 10_000,
          tax_rate: 21,
        },
      ],
    },
  });
  const { id: quoteId } = (await draft.json()) as { id: string };
  expect(
    (await page.request.post(`/api/v1/documents/${quoteId}/issue`)).ok(),
  ).toBe(true);
  await page.goto(`/documents/${quoteId}`);
  await page.getByRole("button", { name: "Aceptado" }).click();
  await expect(page.getByText("Aceptado").first()).toBeVisible();
  await slow("**/api/v1/documents/*/convert");
  const convert = page
    .getByRole("button")
    .filter({ hasText: /^(Convertir en albarán|Convirtiendo…)$/ });
  await expectFeedbackWithin(
    () => convert.click(),
    () => expect(convert).toHaveText("Convirtiendo…", { timeout: 90 }),
  );
});

test("subscribe, invoice delivery notes and reconcile give visible feedback within 100 ms under a delayed network", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);
  const slow = (pattern: string) =>
    page.route(pattern, async (route) => {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 400));
      // The page may have moved on (and handled the route) meanwhile.
      await route.continue().catch(() => undefined);
    });

  // Subscribe: only the immediate feedback matters here, so the delayed
  // request never has to reach Stripe.
  await withDatabase(async (database) => {
    await database`
      INSERT INTO billing_price (lookup_key, stripe_price_id, plan, interval, unit_amount_cents, currency, active, updated_at)
      VALUES
        ('essential_monthly', 'price_e2e_essential_monthly', 'essential', 'month', 900, 'eur', true, now()),
        ('essential_yearly', 'price_e2e_essential_yearly', 'essential', 'year', 9000, 'eur', true, now())
      ON CONFLICT (lookup_key) DO NOTHING
    `;
  });
  await page.goto("/billing");
  await page.route("**/api/v1/billing/checkout", async (route) => {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 400));
    await route
      .fulfill({ status: 503, json: { error: { code: "unavailable" } } })
      .catch(() => undefined);
  });
  const subscribe = page
    .getByRole("button")
    .filter({ hasText: /^(Contratar Esencial|Abriendo el pago…)$/ });
  await expect(subscribe).toBeVisible();
  await expectFeedbackWithin(
    () => subscribe.click(),
    () => expect(subscribe).toHaveText("Abriendo el pago…", { timeout: 90 }),
  );
  await expect(subscribe).toHaveText("Contratar Esencial");
  await page.unroute("**/api/v1/billing/checkout");

  await setCompanyPlan(email, "pro");

  // Invoicing delivery notes from the list.
  const client = await page.request.post("/api/v1/clients", {
    data: {
      name: "Cliente Albaranes, S.L.",
      tax_id: "A87654321",
      address: "Calle del Cliente 2, 46001 Valencia",
    },
  });
  const { id: clientId } = (await client.json()) as { id: string };
  for (const description of ["Entrega 1", "Entrega 2"]) {
    const draft = await page.request.post("/api/v1/documents", {
      data: {
        doc_type: "delivery_note",
        client_id: clientId,
        lines: [
          {
            description,
            quantity: 1,
            unit_price_cents: 10_000,
            tax_rate: 21,
          },
        ],
      },
    });
    const { id } = (await draft.json()) as { id: string };
    expect(
      (await page.request.post(`/api/v1/documents/${id}/issue`)).ok(),
    ).toBe(true);
  }
  await page.goto("/documents?type=delivery_note");
  const boxes = page.getByRole("checkbox", { name: /para facturar/ });
  await expect(boxes).toHaveCount(2);
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await slow("**/api/v1/documents/invoice-delivery-notes");
  const invoice = page
    .getByRole("button")
    .filter({ hasText: /^(Facturar|Facturando…)$/ });
  await expectFeedbackWithin(
    () => invoice.click(),
    () => expect(invoice).toHaveText("Facturando…", { timeout: 90 }),
  );
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+/);
  await page.unroute("**/api/v1/documents/invoice-delivery-notes");

  // Reconciling a suggestion. Account of tests/fixtures/bank/sample.n43.
  const method = await page.request.post("/api/v1/collection-methods", {
    data: {
      kind: "bank_account",
      label: "Cuenta principal",
      holder_name: "Estudio",
      iban: "ES8121000001000123456789",
    },
  });
  expect(method.status(), await method.text()).toBe(201);
  await withDatabase(async (database) => {
    const [company] = await database<{ id: string }[]>`
      SELECT company.id FROM company JOIN "user" ON "user".id = company.user_id
      WHERE "user".email = ${email}
    `;
    const talleresId = crypto.randomUUID();
    await database`
      INSERT INTO client (id, company_id, name, tax_id, created_at, updated_at)
      VALUES (${talleresId}, ${company?.id ?? ""}, 'Talleres Martínez SL', 'B12345674', now(), now())
    `;
    await database`
      INSERT INTO document (id, company_id, document_type, status, number, full_number,
        client_id, issue_date, due_date, subtotal_cents, total_cents, pdf_status,
        created_at, updated_at)
      VALUES (${crypto.randomUUID()}, ${company?.id ?? ""}, 'invoice', 'issued', 1, 'F-2026-0001',
        ${talleresId}, '2026-02-20', '2026-03-15', 16637, 16637, 'ready', now(), now())
    `;
  });
  await page.goto("/reconciliation");
  await page
    .getByLabel("Archivo")
    .setInputFiles("tests/fixtures/bank/sample.n43");
  await page.getByRole("button", { name: "Analizar" }).click();
  await page
    .getByRole("button", { name: "Importar movimientos" })
    .click({ timeout: 30_000 });
  await expect(
    page.getByText(/Importación completada: 20 movimientos nuevos/),
  ).toBeVisible({ timeout: 30_000 });
  await slow("**/api/v1/reconciliations");
  const reconcile = page
    .getByRole("listitem")
    .filter({ hasText: "F-2026-0001" })
    .first()
    .getByRole("button")
    .filter({ hasText: /^(Registrar cobro de|Registrando…)/ });
  await expectFeedbackWithin(
    () => reconcile.click(),
    () => expect(reconcile).toHaveText("Registrando…", { timeout: 90 }),
  );
});

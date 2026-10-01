import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";

function e2eDatabaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) {
    throw new Error("E2E_DATABASE_URL es obligatoria para este flujo.");
  }
  return url;
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

async function setCompanyPlan(
  email: string,
  plan: "free" | "pro",
): Promise<void> {
  const database = postgres(e2eDatabaseUrl(), { max: 1 });
  try {
    await database`
      UPDATE company SET plan = ${plan}
      WHERE user_id = (SELECT id FROM "user" WHERE email = ${email})
    `;
  } finally {
    await database.end({ timeout: 5 });
  }
}

async function registerVerifyAndSignIn(page: Page): Promise<string> {
  const suffix = crypto.randomUUID();
  const email = `e2e-email-share-${suffix}@example.test`;
  const password = "invoice-flash-e2e-password";

  await page.goto("/register");
  await page.getByLabel("Tu nombre").fill("Usuario Email");
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
      legal_name: "Estudio Email, S.L.",
      tax_id: "B12345678",
      address: "Calle del Email 1, 28001 Madrid",
      email,
    },
  });
  expect(companyResponse.status(), await companyResponse.text()).toBe(200);
  await page.request.get("/api/v1/series?doc_type=invoice");

  const clientResponse = await page.request.post("/api/v1/clients", {
    data: {
      name: "Cliente Email",
      // Issuing an invoice requires the client's tax id and address.
      tax_id: "A87654321",
      address: "Avenida del Cliente 2, 46001 Valencia",
    },
  });
  const client = (await clientResponse.json()) as { id: string };
  const createResponse = await page.request.post("/api/v1/documents", {
    data: {
      doc_type: "invoice",
      client_id: client.id,
      lines: [
        {
          description: "Servicio por correo",
          quantity: "1",
          unit_price_cents: 5_000,
          tax_rate: "21.00",
        },
      ],
    },
  });
  const created = (await createResponse.json()) as { id: string };
  const issueResponse = await page.request.post(
    `/api/v1/documents/${created.id}/issue`,
  );
  expect(issueResponse.status(), await issueResponse.text()).toBe(200);
  return created.id;
}

test("el plan gratuito muestra alternativas y no ofrece el envío por correo", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);
  const documentId = await configureCompanyAndIssueInvoice(page, email);

  await page.goto(`/documents/${documentId}`);
  await expect(
    page.getByText("El envío por correo está disponible en el plan de pago."),
  ).toBeVisible();
  await expect(page.getByLabel("Correo del destinatario")).toHaveCount(0);
});

test("el plan de pago envía por correo y una reentrega con la misma clave no duplica el envío", async ({
  page,
}) => {
  const email = await registerVerifyAndSignIn(page);
  const documentId = await configureCompanyAndIssueInvoice(page, email);
  await setCompanyPlan(email, "pro");

  await page.goto(`/documents/${documentId}`);
  await page.reload();

  let capturedIdempotencyKey: string | undefined;
  let capturedBody: string | undefined;
  await page.route("**/api/v1/documents/*/email", async (route) => {
    capturedIdempotencyKey = route.request().headers()["idempotency-key"];
    capturedBody = route.request().postData() ?? undefined;
    await route.continue();
  });

  await page.getByLabel("Correo del destinatario").fill("cliente@example.test");
  const emailResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/email") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Enviar por correo" }).click();
  const emailResponse = await emailResponsePromise;
  expect(emailResponse.status()).toBe(202);
  await expect(
    page.getByText("Enviado").or(page.getByText("En cola")),
  ).toBeVisible();

  expect(capturedIdempotencyKey).toBeTruthy();
  expect(capturedBody).toBeTruthy();

  // A network-level retry of the exact same request (same Idempotency-Key)
  // must resolve to the same delivery instead of sending a second email.
  const replayResponse = await page.request.post(
    `/api/v1/documents/${documentId}/email`,
    {
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": capturedIdempotencyKey as string,
      },
      data: capturedBody as string,
    },
  );
  expect(replayResponse.status()).toBe(202);
  const firstBody = (await emailResponse.json()) as { delivery_id: string };
  const replayBody = (await replayResponse.json()) as { delivery_id: string };
  expect(replayBody.delivery_id).toBe(firstBody.delivery_id);

  await page.reload();
  const historyEntries = page
    .locator("li")
    .filter({ hasText: /En cola|Enviando|Enviado|Fallido/ });
  await expect(historyEntries).toHaveCount(1);
});

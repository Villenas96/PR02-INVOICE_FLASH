import { createHash, randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  expectAccessible,
  registerVerifyAndSignIn,
  saveFiscalData,
  setCompanyPlan,
} from "./helpers";

/** US15 (specs/002, quickstart V15): connect an AI assistant over MCP. */

const REDIRECT_URI = "https://assistant.example.test/callback";

test("el asistente se conecta con consentimiento, usa MCP y deja de funcionar al revocarlo", async ({
  page,
  baseURL,
}) => {
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);
  await setCompanyPlan(email, "pro");

  // The assistant registers itself (public client, PKCE) and asks for access.
  // Requests carry the browser session, so Better Auth wants an Origin.
  const origin = { Origin: baseURL ?? "" };
  const registered = await page.request.post("/api/auth/oauth2/register", {
    headers: origin,
    data: {
      client_name: "Asistente E2E",
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
  });
  expect(
    registered.ok(),
    `${registered.status()} ${await registered.text()}`,
  ).toBe(true);
  const { client_id: clientId } = (await registered.json()) as {
    client_id: string;
  };
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const resource = `${baseURL}/api/mcp`;

  // The redirect target is external: capture the code instead of leaving.
  let code = "";
  await page.route(`${REDIRECT_URI}**`, (route) => {
    code = new URL(route.request().url()).searchParams.get("code") ?? "";
    return route.fulfill({ status: 200, body: "ok" });
  });

  await page.goto(
    `/api/auth/oauth2/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      scope: "invoicing offline_access",
      state: "e2e",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource,
    })}`,
  );
  await expect(page).toHaveURL(/\/oauth\/consent/);
  await expect(
    page.getByRole("heading", { name: /Asistente E2E quiere acceder/ }),
  ).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Permitir acceso" }).click();
  await expect.poll(() => code, { timeout: 15_000 }).not.toBe("");

  const token = await page.request.post("/api/auth/oauth2/token", {
    headers: origin,
    form: {
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
      resource,
    },
  });
  expect(token.ok()).toBe(true);
  const { access_token: accessToken } = (await token.json()) as {
    access_token: string;
  };

  const call = (method: string, params?: unknown, bearer = accessToken) =>
    page.request.post("/api/mcp", {
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: "application/json, text/event-stream",
      },
      data: { jsonrpc: "2.0", id: 1, method, params },
    });

  const tools = await call("tools/list");
  expect(tools.status()).toBe(200);
  const listed = (await tools.json()) as {
    result: { tools: Array<{ name: string }> };
  };
  expect(listed.result.tools.map((tool) => tool.name)).toContain(
    "request_issue",
  );
  expect((await page.request.post("/api/mcp", { data: {} })).status()).toBe(
    401,
  );

  // The owner sees the connection and revokes it.
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Asistentes de IA" }).click();
  await expect(page.getByText("Asistente E2E")).toBeVisible();
  await expectAccessible(page);
  await page
    .getByRole("button", { name: "Revocar el acceso de Asistente E2E" })
    .click();
  await expect(
    page.getByText("No hay ningún asistente conectado."),
  ).toBeVisible();

  expect((await call("tools/list")).status()).toBe(401);
});

test("sin plan Pro no se puede conectar un asistente", async ({ page }) => {
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);
  await expect(
    page.getByRole("heading", { name: "Conexión con asistentes de IA" }),
  ).toBeVisible();
  await expectAccessible(page);
});

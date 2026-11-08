import { createHash, randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  registerVerifyAndSignIn,
  saveFiscalData,
  setCompanyPlan,
} from "./helpers";

/**
 * Quickstart V15 (specs/002, T189) against staging: the Cloudflare rate
 * limiter of /api/mcp (60 requests/min per connection, research.md R19) and
 * the Pro gate after a downgrade. Locally there is no rate-limit binding, so
 * this file only runs when E2E_BASE_URL points at staging.
 */
test.skip(
  !(process.env.E2E_BASE_URL ?? "").includes("staging"),
  "Solo contra staging (binding MCP_RATE_LIMITER).",
);

const REDIRECT_URI = "https://assistant.example.test/callback";

test("V15: una ráfaga de más de 60 peticiones por minuto se limita y bajar de Pro bloquea el asistente", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);
  await setCompanyPlan(email, "pro");

  const origin = { Origin: baseURL ?? "" };
  const registered = await page.request.post("/api/auth/oauth2/register", {
    headers: origin,
    data: {
      client_name: "Asistente T189",
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
  });
  expect(registered.ok()).toBe(true);
  const { client_id: clientId } = (await registered.json()) as {
    client_id: string;
  };
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const resource = `${baseURL}/api/mcp`;

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
      state: "t189",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource,
    })}`,
  );
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

  const call = () =>
    page.request.post("/api/mcp", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json, text/event-stream",
      },
      data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });

  // 250 calls in well under a minute, in batches of 10. Cloudflare's limiter
  // is approximate (per-machine counters, synced asynchronously): on staging
  // (08/11/2026) the first 429 came at call 151, so this checks that a burst
  // is cut off, not the exact threshold.
  const statuses: number[] = [];
  for (let batch = 0; batch < 25; batch += 1) {
    const responses = await Promise.all(Array.from({ length: 10 }, call));
    statuses.push(...responses.map((response) => response.status()));
  }
  const ok = statuses.filter((status) => status === 200).length;
  const limited = statuses.filter((status) => status === 429).length;
  test.info().annotations.push({
    type: "burst",
    description: `${ok} × 200, ${limited} × 429 de ${statuses.length}`,
  });
  expect(ok + limited).toBe(statuses.length);
  expect(limited).toBeGreaterThan(0);
  expect(ok).toBeGreaterThanOrEqual(60);

  // Downgrade: the connection stays, but every call is refused (403).
  await setCompanyPlan(email, "essential");
  await page.waitForTimeout(61_000);
  const blocked = await call();
  expect(blocked.status()).toBe(403);
});

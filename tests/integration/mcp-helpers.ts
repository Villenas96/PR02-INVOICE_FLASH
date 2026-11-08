import { createHash, randomBytes } from "node:crypto";

import { expect } from "vitest";

import { APP_BASE_URL, type AuthHandler } from "./http";

export const REDIRECT_URI = "https://assistant.example.test/callback";

export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export async function registerClient(
  auth: AuthHandler,
  name = "Asistente de prueba",
): Promise<string> {
  const response = await auth.handler(
    new Request(`${APP_BASE_URL}/api/auth/oauth2/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: name,
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    }),
  );
  const body = (await response.json()) as { client_id?: string };
  expect([200, 201], JSON.stringify(body)).toContain(response.status);
  return body.client_id as string;
}

/** Runs authorize → consent for a signed-in user; returns the auth code. */
export async function authorizeAndConsent(input: {
  auth: AuthHandler;
  cookie: string;
  clientId: string;
  resource: string;
  challenge: string;
  scope?: string;
}): Promise<string> {
  const authorize = await input.auth.handler(
    new Request(
      `${APP_BASE_URL}/api/auth/oauth2/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: input.clientId,
        redirect_uri: REDIRECT_URI,
        scope: input.scope ?? "invoicing offline_access",
        state: "xyz",
        code_challenge: input.challenge,
        code_challenge_method: "S256",
        resource: input.resource,
      })}`,
      { headers: { Cookie: input.cookie } },
    ),
  );
  const location = authorize.headers.get("location") ?? "";
  expect(authorize.status, location).toBe(302);
  const oauthQuery = new URL(location, APP_BASE_URL).search.slice(1);
  const consent = await input.auth.handler(
    new Request(`${APP_BASE_URL}/api/auth/oauth2/consent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: input.cookie },
      body: JSON.stringify({ accept: true, oauth_query: oauthQuery }),
    }),
  );
  const body = (await consent.json()) as { url?: string };
  expect(consent.status, JSON.stringify(body)).toBe(200);
  const code = new URL(body.url as string).searchParams.get("code");
  expect(code).toBeTruthy();
  return code as string;
}

export async function exchangeCode(input: {
  auth: AuthHandler;
  clientId: string;
  code: string;
  verifier?: string;
  resource: string;
}): Promise<Response> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: REDIRECT_URI,
    client_id: input.clientId,
    resource: input.resource,
  });
  if (input.verifier) {
    form.set("code_verifier", input.verifier);
  }
  return input.auth.handler(
    new Request(`${APP_BASE_URL}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    }),
  );
}

import { eq } from "drizzle-orm";
import { expect } from "vitest";

import type { Database } from "@/db";
import { clients, companies, users } from "@/db/schema";

/**
 * HTTP contract helpers for v2 route tests. Test files still declare their
 * own `vi.mock` calls (hoisted per file) and pass the mocked Better Auth
 * instance and database here.
 */

export const APP_BASE_URL = "http://localhost:3000";

export interface AuthHandler {
  handler(request: Request): Promise<Response>;
}

export interface Tenant {
  userId: string;
  companyId: string;
  clientId: string;
  email: string;
  cookie: string;
}

function sessionCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(
    /(?:__Secure-)?better-auth\.session_token=[^;,]+/,
  );
  if (!match) {
    throw new Error("Better Auth no ha devuelto la cookie de sesión.");
  }
  return match[0];
}

/** Signs up, verifies and signs in a user; returns its session cookie. */
export async function signedInUser(
  auth: AuthHandler,
  database: Database,
): Promise<{ userId: string; email: string; cookie: string }> {
  const email = `contract-${crypto.randomUUID()}@example.test`;
  const password = "contract-password-123";
  const signUp = await auth.handler(
    new Request(`${APP_BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Contract user", email, password }),
    }),
  );
  expect(signUp.status).toBe(200);
  const [user] = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (!user) {
    throw new Error("No se ha creado el usuario de contrato.");
  }
  await database
    .update(users)
    .set({ emailVerified: true, updatedAt: new Date() })
    .where(eq(users.id, user.id));
  const signIn = await auth.handler(
    new Request(`${APP_BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  );
  expect(signIn.status).toBe(200);
  return { userId: user.id, email, cookie: sessionCookie(signIn) };
}

/** Signed-in owner with complete fiscal data and one issuable client. */
export async function createTenant(
  auth: AuthHandler,
  database: Database,
  plan: (typeof companies.$inferInsert)["plan"] = "basic",
): Promise<Tenant> {
  const user = await signedInUser(auth, database);
  const companyId = crypto.randomUUID();
  const clientId = crypto.randomUUID();
  const now = new Date();
  await database.insert(companies).values({
    id: companyId,
    userId: user.userId,
    legalName: "Empresa de contrato, S.L.",
    taxId: "B12345678",
    address: "Calle del Contrato 1, Madrid",
    email: user.email,
    plan,
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(clients).values({
    id: clientId,
    companyId,
    name: "Cliente de contrato, S.A.",
    taxId: "A87654321",
    address: "Avenida del Cliente 2, Valencia",
    email: "cliente@example.test",
  });
  return { ...user, companyId, clientId };
}

export function authenticatedRequest(
  tenant: { cookie: string },
  path: string,
  options: RequestInit = {},
): Request {
  const headers = new Headers(options.headers);
  headers.set("Cookie", tenant.cookie);
  // FormData sets its own multipart boundary.
  if (
    options.body &&
    !(options.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }
  return new Request(`${APP_BASE_URL}${path}`, { ...options, headers });
}

export function routeContext<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

export async function jsonBody(
  response: Response,
): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

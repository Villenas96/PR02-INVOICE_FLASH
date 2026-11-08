import { mcp } from "@better-auth/mcp";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins";

import { createDatabase } from "@/db";
import * as schema from "@/db/schema";
import { createUuidV7 } from "@/lib/ids";
import { requestSafeSingleton } from "@/lib/request-safe-singleton";
import {
  EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
  type EmailQueue,
  enqueueAuthEmailDelivery,
  PASSWORD_RESET_EXPIRES_IN_SECONDS,
} from "@/services/email/auth-deliveries";

const authSchema = {
  user: schema.users,
  session: schema.sessions,
  account: schema.accounts,
  verification: schema.verifications,
  rateLimit: schema.rateLimits,
  // OAuth provider of the MCP assistant connection (US15, FR-054).
  jwks: schema.jwks,
  oauthClient: schema.oauthClients,
  oauthResource: schema.oauthResources,
  oauthClientResource: schema.oauthClientResources,
  oauthRefreshToken: schema.oauthRefreshTokens,
  oauthAccessToken: schema.oauthAccessTokens,
  oauthConsent: schema.oauthConsents,
  oauthClientAssertion: schema.oauthClientAssertions,
};

const AUTH_BASE_URL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

/** Protected resource served by the MCP endpoint (audience of its tokens). */
export const MCP_RESOURCE = `${AUTH_BASE_URL.replace(/\/+$/, "")}/api/mcp`;
/** The single scope of the assistant connection; the plan gate is per request. */
export const MCP_SCOPE = "invoicing";

export type AuthEmailPurpose = "reset_password" | "verify_email";

export interface AuthEmailDeliveryRequest {
  purpose: AuthEmailPurpose;
  userId: string;
  recipientEmail: string;
  token: string;
}

export type AuthEmailDeliveryHandler = (
  request: AuthEmailDeliveryRequest,
) => Promise<void>;

let authEmailDeliveryHandler: AuthEmailDeliveryHandler = async (request) => {
  const { env } = await getCloudflareContext({ async: true });
  const queue = (
    env as CloudflareEnv & {
      EMAIL_SEND_QUEUE?: EmailQueue;
    }
  ).EMAIL_SEND_QUEUE;

  if (!queue) {
    throw new Error(
      "EMAIL_SEND_QUEUE debe estar configurada para enviar correos de autenticación.",
    );
  }

  await enqueueAuthEmailDelivery(request, { queue });
};

export function setAuthEmailDeliveryHandler(handler: AuthEmailDeliveryHandler) {
  authEmailDeliveryHandler = handler;
}

function getAuthSecret() {
  const secret = process.env.BETTER_AUTH_SECRET;

  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET debe estar configurado para iniciar la autenticación.",
    );
  }

  return secret;
}

function createAuth() {
  return betterAuth({
    appName: "Factum",
    baseURL: AUTH_BASE_URL,
    secret: getAuthSecret(),
    database: drizzleAdapter(createDatabase(), {
      provider: "pg",
      schema: authSchema,
      camelCase: true,
    }),
    // Better Auth activa por defecto su límite de 3 registros/10s en cualquier
    // build de producción (incluida la vista previa de Playwright, que ejecuta
    // el build real). El flag solo lo desactiva en esa vista previa E2E.
    // Los contadores van a Postgres: la memoria por isolate no limita entre
    // instancias de Worker.
    rateLimit: {
      storage: "database",
      enabled:
        process.env.E2E_DISABLE_AUTH_RATE_LIMIT === "true" ? false : undefined,
    },
    advanced: {
      database: {
        generateId: () => createUuidV7(),
      },
      // On Cloudflare Workers the client IP comes from `cf-connecting-ip`, set
      // by Cloudflare's edge (clients cannot forge it). Without it Better Auth
      // falls back to one shared rate-limit bucket per path, so a single
      // client could exhaust sign-in/sign-up limits for everyone. Locally
      // (dev/test) Better Auth falls back to 127.0.0.1.
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip"],
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: PASSWORD_RESET_EXPIRES_IN_SECONDS,
      sendResetPassword: async ({ user, token }) =>
        authEmailDeliveryHandler({
          purpose: "reset_password",
          userId: user.id,
          recipientEmail: user.email,
          token,
        }),
    },
    plugins: [
      // Tokens are minted by the OAuth provider only; do not attach a JWT to
      // every get-session response (it would touch the signing keys per request).
      jwt({ disableSettingJwtHeader: true }),
      mcp({
        loginPage: "/login",
        consentPage: "/oauth/consent",
        resource: MCP_RESOURCE,
        scopes: [MCP_SCOPE, "offline_access"],
        clientRegistrationDefaultScopes: [MCP_SCOPE, "offline_access"],
        // Public MCP clients (ChatGPT, Claude) register themselves (PKCE only).
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
      }),
    ],
    emailVerification: {
      expiresIn: EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, token }) =>
        authEmailDeliveryHandler({
          purpose: "verify_email",
          userId: user.id,
          recipientEmail: user.email,
          token,
        }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * Better Auth initialises its context once per instance, and plugin init
 * queries the database (the oauth-provider seeds the MCP resource). Creating
 * the instance at module load let short requests such as RSC prefetches start
 * that query and end before it resolved, leaving a context that never settles
 * and hanging every later page in the isolate (specs/002 research.md R23).
 */
export const getAuth = requestSafeSingleton(
  createAuth,
  (instance) => instance.$context,
);

type ApiMethod = "getSession" | "getJwks" | "signUpEmail";

function deferredApi<K extends ApiMethod>(name: K): Auth["api"][K] {
  return (async (...args: unknown[]) => {
    const api = (await getAuth()).api as unknown as Record<
      K,
      (...callArgs: unknown[]) => Promise<unknown>
    >;
    return api[name](...args);
  }) as unknown as Auth["api"][K];
}

/** Same surface as the Better Auth instance, resolved per request. */
export const auth = {
  handler: async (request: Request) => (await getAuth()).handler(request),
  api: {
    getSession: deferredApi("getSession"),
    getJwks: deferredApi("getJwks"),
    signUpEmail: deferredApi("signUpEmail"),
  },
};

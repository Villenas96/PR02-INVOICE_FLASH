import { getCloudflareContext } from "@opennextjs/cloudflare";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { createDatabase } from "@/db";
import * as schema from "@/db/schema";
import { createUuidV7 } from "@/lib/ids";
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
};

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

export const auth = betterAuth({
  appName: "Invoice Flash",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
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

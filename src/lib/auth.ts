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
  advanced: {
    database: {
      generateId: () => createUuidV7(),
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

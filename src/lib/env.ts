/**
 * Typed accessor for the configuration added in v2 (Stripe, Factum sender,
 * public base URL, Pro checkout flag). Values come from `process.env` in route
 * handlers (OpenNext copies Worker vars and secrets there) or from the Worker
 * `env` object in queue/cron handlers, so every reader takes an explicit
 * source. Error messages name the variable but never echo any value.
 */
/** `process.env`, the Worker `env` binding object or a plain record. */
export type EnvSource = object;

export type RequiredEnvName =
  | "STRIPE_SECRET_KEY"
  | "STRIPE_WEBHOOK_SECRET"
  | "EMAIL_FROM"
  | "APP_BASE_URL"
  | "BETTER_AUTH_SECRET";

const DESCRIPTIONS: Record<RequiredEnvName, string> = {
  STRIPE_SECRET_KEY: "la clave secreta de Stripe",
  STRIPE_WEBHOOK_SECRET: "el secreto de firma del webhook de Stripe",
  EMAIL_FROM: "el remitente de los correos (Factum <no-reply@…>)",
  APP_BASE_URL: "la URL pública de la aplicación",
  BETTER_AUTH_SECRET: "el secreto de sesiones y enlaces de descarga",
};

export class MissingEnvError extends Error {
  constructor(public readonly variable: RequiredEnvName) {
    super(
      `Falta la variable de entorno ${variable}: configura ${DESCRIPTIONS[variable]} en .dev.vars o como secreto del Worker.`,
    );
    this.name = "MissingEnvError";
  }
}

function defaultSource(): EnvSource {
  return typeof process === "undefined" ? {} : process.env;
}

function rawValue(source: EnvSource, name: string): unknown {
  return (source as Record<string, unknown>)[name];
}

function readText(source: EnvSource, name: string): string | undefined {
  const value = rawValue(source, name);
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function requireEnv(
  name: RequiredEnvName,
  source: EnvSource = defaultSource(),
): string {
  const value = readText(source, name);
  if (!value) {
    throw new MissingEnvError(name);
  }
  return value;
}

export function optionalEnv(
  name: string,
  source: EnvSource = defaultSource(),
): string | undefined {
  return readText(source, name);
}

/** Sender for every email; formatted `Factum <no-reply@…>`. */
export function getEmailFrom(source: EnvSource = defaultSource()): string {
  return requireEnv("EMAIL_FROM", source);
}

export function getEmailReplyTo(
  source: EnvSource = defaultSource(),
): string | undefined {
  return readText(source, "EMAIL_REPLY_TO");
}

/** Public base URL without a trailing slash. */
export function getAppBaseUrl(source: EnvSource = defaultSource()): string {
  return requireEnv("APP_BASE_URL", source).replace(/\/+$/, "");
}

export function getStripeSecretKey(
  source: EnvSource = defaultSource(),
): string {
  return requireEnv("STRIPE_SECRET_KEY", source);
}

export function getStripeWebhookSecret(
  source: EnvSource = defaultSource(),
): string {
  return requireEnv("STRIPE_WEBHOOK_SECRET", source);
}

/** Pro is purchasable only once this flag is explicitly `true` (Inc. 3). */
export function isProCheckoutEnabled(
  source: EnvSource = defaultSource(),
): boolean {
  const value =
    readText(source, "PRO_CHECKOUT_ENABLED") ??
    rawValue(source, "PRO_CHECKOUT_ENABLED");
  return value === true || value === "true";
}

/**
 * Stripe tax rate (IVA 21 %, inclusive) applied to subscription prices so
 * Stripe's invoices are valid Spanish invoices. Optional in local/test.
 */
export function getStripeTaxRateId(
  source: EnvSource = defaultSource(),
): string | undefined {
  return readText(source, "STRIPE_TAX_RATE_ID");
}

/** Signs public download tokens (`/x/:token`); reuses the auth secret. */
export function getDownloadTokenSecret(
  source: EnvSource = defaultSource(),
): string {
  return requireEnv("BETTER_AUTH_SECRET", source);
}

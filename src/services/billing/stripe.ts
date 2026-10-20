import Stripe from "stripe";

import { getStripeSecretKey, getStripeWebhookSecret } from "@/lib/env";

/**
 * The slice of the Stripe API the billing services use. Narrowing it keeps
 * tests honest: a fake only has to implement what production calls.
 */
export type StripeClient = Pick<
  Stripe,
  "billingPortal" | "checkout" | "customers" | "prices" | "subscriptions"
>;

/**
 * workerd has no Node HTTP stack: the fetch HTTP client and SubtleCrypto
 * provider are the Worker-compatible transports (research R1).
 */
export function createStripeClient(secretKey = getStripeSecretKey()): Stripe {
  return new Stripe(secretKey, {
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
    appInfo: { name: "Factum" },
  });
}

let stripeFactory: () => StripeClient = () => createStripeClient();

export function getStripeClient(): StripeClient {
  return stripeFactory();
}

/** Test seam: replace the Stripe client (pass `null` to restore). */
export function setStripeClientFactory(
  factory: (() => StripeClient) | null,
): void {
  stripeFactory = factory ?? (() => createStripeClient());
}

const cryptoProvider = Stripe.createSubtleCryptoProvider();

export class InvalidWebhookSignatureError extends Error {
  constructor() {
    super("La firma del webhook de Stripe no es válida.");
    this.name = "InvalidWebhookSignatureError";
  }
}

/**
 * Verifies `Stripe-Signature` over the raw body. Any failure is reported
 * without echoing the payload or the header.
 */
export async function verifyStripeWebhook(
  payload: string,
  signature: string | null,
  secret = getStripeWebhookSecret(),
): Promise<Stripe.Event> {
  if (!signature) {
    throw new InvalidWebhookSignatureError();
  }
  try {
    return await Stripe.webhooks.constructEventAsync(
      payload,
      signature,
      secret,
      undefined,
      cryptoProvider,
    );
  } catch {
    throw new InvalidWebhookSignatureError();
  }
}

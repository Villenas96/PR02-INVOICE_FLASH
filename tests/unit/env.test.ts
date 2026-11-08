import { describe, expect, it } from "vitest";

import {
  getAppBaseUrl,
  getEmailFrom,
  getEmailReplyTo,
  isProCheckoutEnabled,
  MissingEnvError,
  requireEnv,
} from "@/lib/env";

describe("env accessor", () => {
  it("returns trimmed required values", () => {
    expect(
      getEmailFrom({ EMAIL_FROM: "  Factum <no-reply@factum.app> " }),
    ).toBe("Factum <no-reply@factum.app>");
    expect(getAppBaseUrl({ APP_BASE_URL: "https://factum.app/" })).toBe(
      "https://factum.app",
    );
  });

  it("throws a Spanish error naming the variable without echoing values", () => {
    expect(() => requireEnv("STRIPE_SECRET_KEY", {})).toThrow(MissingEnvError);
    expect(() =>
      requireEnv("STRIPE_SECRET_KEY", { STRIPE_SECRET_KEY: " " }),
    ).toThrow(/Falta la variable de entorno STRIPE_SECRET_KEY/);
  });

  it("treats optional values and the Pro flag conservatively", () => {
    expect(getEmailReplyTo({})).toBeUndefined();
    expect(isProCheckoutEnabled({})).toBe(false);
    expect(isProCheckoutEnabled({ PRO_CHECKOUT_ENABLED: "false" })).toBe(false);
    expect(isProCheckoutEnabled({ PRO_CHECKOUT_ENABLED: "true" })).toBe(true);
    expect(isProCheckoutEnabled({ PRO_CHECKOUT_ENABLED: true })).toBe(true);
  });
});

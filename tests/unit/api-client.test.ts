import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError, apiRequest, upsellFromError } from "@/lib/api/client";

function mockResponse(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json(body, { status })),
  );
}

describe("apiRequest errors", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds each field message so the user knows what to fix", async () => {
    mockResponse(400, {
      error: {
        code: "validation_error",
        message: "Revisa los datos del cliente y las líneas antes de emitir.",
        fields: {
          "client.address":
            "Añade la dirección del cliente para poder emitir la factura.",
          "lines.0.quantity": "La cantidad debe ser mayor que cero.",
        },
      },
    });

    const error = await apiRequest("/api/v1/documents/x/issue").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("validation_error");
    expect((error as ApiClientError).message).toBe(
      "Revisa los datos del cliente y las líneas antes de emitir. " +
        "Añade la dirección del cliente para poder emitir la factura. " +
        "La cantidad debe ser mayor que cero.",
    );
  });

  it("does not repeat identical field messages", async () => {
    mockResponse(400, {
      error: {
        message: "Revisa las líneas.",
        fields: {
          "lines.0.quantity": "La cantidad debe ser mayor que cero.",
          "lines.1.quantity": "La cantidad debe ser mayor que cero.",
        },
      },
    });

    await expect(apiRequest("/x")).rejects.toThrow(
      "Revisa las líneas. La cantidad debe ser mayor que cero.",
    );
  });

  it("keeps the plain message when there are no field details", async () => {
    mockResponse(409, { error: { code: "conflict", message: "Ya emitido." } });

    await expect(apiRequest("/x")).rejects.toThrow(/^Ya emitido\.$/);
  });
});

describe("upsellFromError", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("turns feature_not_in_plan into a feature upsell", async () => {
    mockResponse(403, {
      error: {
        code: "feature_not_in_plan",
        message: "Las facturas recurrentes están disponibles en el plan Pro.",
        details: { feature: "recurring", required_plan: "pro" },
      },
    });

    const error = await apiRequest("/api/v1/recurring-templates").catch(
      (caught: unknown) => caught,
    );

    expect(upsellFromError(error)).toEqual({
      kind: "feature",
      message: "Las facturas recurrentes están disponibles en el plan Pro.",
      feature: "recurring",
      requiredPlan: "pro",
      upgradeUrl: "/billing",
    });
  });

  it("turns plan_limit_reached into a limit upsell", async () => {
    mockResponse(402, {
      error: {
        code: "plan_limit_reached",
        message: "Has alcanzado el límite de 5 facturas este mes.",
        details: {
          document_type: "invoice",
          limit: 5,
          used: 5,
          upgrade_url: "/billing",
        },
      },
    });

    const error = await apiRequest("/api/v1/documents/x/issue").catch(
      (caught: unknown) => caught,
    );

    expect(upsellFromError(error)).toMatchObject({
      kind: "limit",
      documentType: "invoice",
      limit: 5,
      used: 5,
    });
  });

  it("ignores any other error", () => {
    expect(upsellFromError(new ApiClientError("x", "conflict"))).toBeNull();
    expect(upsellFromError(new Error("x"))).toBeNull();
  });
});

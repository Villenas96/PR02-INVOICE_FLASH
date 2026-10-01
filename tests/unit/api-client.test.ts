import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError, apiRequest } from "@/lib/api/client";

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

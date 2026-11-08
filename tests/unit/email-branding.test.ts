import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { renderAuthEmailTemplate } from "@/services/email/templates/auth";
import { renderDocumentEmailTemplate } from "@/services/email/templates/document";

// The email handler module reaches the Better Auth instance through shared
// service imports; the transport under test never needs it.
vi.mock("@/lib/auth", () => ({ auth: {} }));
const { createResendEmailProvider } = await import(
  "@/workers/handlers/email-send"
);

const EMAIL_FROM = "Factum <no-reply@factum.example>";
const TEMPLATES_DIR = resolve("src/services/email/templates");

function renderedSamples() {
  return [
    renderDocumentEmailTemplate({
      documentType: "invoice",
      fullNumber: "2026-0001",
      totalFormatted: "121,00 €",
      issuerLegalName: "Estudio Norte, S.L.",
      shareUrl: "https://factum.example/d/token",
      customMessage: "Gracias por tu confianza.",
    }),
    renderDocumentEmailTemplate({
      documentType: "proforma",
      fullNumber: "PRO-2026-0001",
      totalFormatted: "50,00 €",
      issuerLegalName: "Estudio Norte, S.L.",
      shareUrl: "https://factum.example/d/token",
      customMessage: null,
    }),
    renderAuthEmailTemplate("verify_email", "https://factum.example/verify"),
    renderAuthEmailTemplate("reset_password", "https://factum.example/reset"),
  ];
}

describe("Factum email branding (FR-001)", () => {
  it("never shows the Invoice Flash brand in any rendered email", () => {
    for (const template of renderedSamples()) {
      for (const part of [template.subject, template.text, template.html]) {
        expect(part).not.toMatch(/invoice\s*flash/i);
      }
      expect(template.html).toContain("Factum");
    }
  });

  it("names Factum in account emails", () => {
    const verify = renderAuthEmailTemplate("verify_email", "https://x.test");
    expect(verify.subject).toContain("Factum");
  });

  it("keeps every template source free of the old brand", async () => {
    const files = (await readdir(TEMPLATES_DIR)).filter((file) =>
      file.endsWith(".ts"),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = await readFile(resolve(TEMPLATES_DIR, file), "utf8");
      expect(source, file).not.toMatch(/invoice\s*flash/i);
    }
  });

  it("sends from EMAIL_FROM with the requested Reply-To", async () => {
    const fetchImplementation = vi.fn(async () =>
      Response.json({ id: "re_123" }),
    );
    const provider = createResendEmailProvider({
      apiKey: "re_test",
      from: EMAIL_FROM,
      fetchImplementation: fetchImplementation as unknown as typeof fetch,
    });

    await provider.send({
      to: "cliente@example.test",
      subject: "Factura",
      text: "Hola",
      html: "<p>Hola</p>",
      idempotencyKey: "email/1",
      replyTo: "facturacion@estudio.example",
    });
    await provider.send({
      to: "cliente@example.test",
      subject: "Verifica",
      text: "Hola",
      html: "<p>Hola</p>",
      idempotencyKey: "email/2",
    });

    const bodies = fetchImplementation.mock.calls.map(
      (call) =>
        JSON.parse(
          String((call as unknown as [string, RequestInit])[1].body),
        ) as Record<string, unknown>,
    );
    expect(bodies[0]).toMatchObject({
      from: EMAIL_FROM,
      reply_to: "facturacion@estudio.example",
    });
    expect(bodies[1]?.from).toBe(EMAIL_FROM);
    expect(bodies[1]).not.toHaveProperty("reply_to");
  });
});

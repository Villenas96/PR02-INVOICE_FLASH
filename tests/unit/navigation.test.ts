import { describe, expect, it } from "vitest";

import { buildNavigation } from "@/lib/navigation";
import type { DocumentType } from "@/lib/plan";

const creatable: DocumentType[] = [
  "invoice",
  "proforma",
  "quote",
  "delivery_note",
];

function labels(items: Array<{ label: string }>): string[] {
  return items.map((item) => item.label);
}

describe("buildNavigation", () => {
  it.each([
    ["basic", ["Facturas", "Clientes", "Productos", "Ajustes"]],
    ["essential", ["Facturas", "Clientes", "Productos", "Gestoría", "Ajustes"]],
  ] as const)(
    "gives %s the reduced navigation with only an upgrade entry",
    (plan, expected) => {
      const navigation = buildNavigation({
        plan,
        uiMode: null,
        usedDocumentTypes: ["invoice"],
        creatableTypes: creatable,
      });
      expect(navigation.mode).toBe("simple");
      expect(labels(navigation.primary)).toEqual(expected);
      expect(navigation.more).toEqual([]);
      expect(navigation.upgrade).toEqual({
        key: "upgrade",
        label: "Mejorar a Pro",
        href: "/billing",
      });
      expect(navigation.newDocumentTypes).toEqual(creatable);
    },
  );

  it("ignores a stored full preference after a downgrade", () => {
    const navigation = buildNavigation({
      plan: "essential",
      uiMode: "full",
      usedDocumentTypes: [],
      creatableTypes: creatable,
    });
    expect(navigation.mode).toBe("simple");
    expect(navigation.more).toEqual([]);
  });

  it("adds a document type to the simple navigation after its first use", () => {
    const navigation = buildNavigation({
      plan: "basic",
      uiMode: null,
      usedDocumentTypes: ["invoice", "quote", "proforma", "receipt"],
      creatableTypes: creatable,
    });
    expect(labels(navigation.primary)).toEqual([
      "Facturas",
      "Proformas",
      "Presupuestos",
      "Clientes",
      "Productos",
      "Ajustes",
    ]);
    expect(navigation.primary.find((item) => item.key === "quote")?.href).toBe(
      "/documents?type=quote",
    );
  });

  it("gives Pro the full interface by default without an upgrade entry", () => {
    const navigation = buildNavigation({
      plan: "pro",
      uiMode: null,
      usedDocumentTypes: [],
      creatableTypes: creatable,
    });
    expect(navigation.mode).toBe("full");
    expect(labels(navigation.primary)).toEqual([
      "Resumen",
      "Documentos",
      "Clientes",
      "Productos",
      "Recurrentes",
      "Conciliación",
      "Exportar",
      "Ajustes",
    ]);
    expect(navigation.more).toEqual([]);
    expect(navigation.upgrade).toBeNull();
  });

  it("keeps Pro features under «Más» when Pro chooses the simple interface", () => {
    const navigation = buildNavigation({
      plan: "pro",
      uiMode: "simple",
      usedDocumentTypes: ["invoice"],
      creatableTypes: creatable,
    });
    expect(navigation.mode).toBe("simple");
    expect(labels(navigation.primary)).toEqual([
      "Facturas",
      "Clientes",
      "Productos",
      "Ajustes",
    ]);
    expect(labels(navigation.more)).toEqual([
      "Panel completo",
      "Recurrentes",
      "Conciliación",
      "Exportar",
    ]);
    expect(navigation.upgrade).toBeNull();
  });

  it("only offers creatable types in «Nuevo»", () => {
    const navigation = buildNavigation({
      plan: "basic",
      uiMode: null,
      usedDocumentTypes: [],
      creatableTypes: ["invoice", "proforma"],
    });
    expect(navigation.newDocumentTypes).toEqual(["invoice", "proforma"]);
  });
});

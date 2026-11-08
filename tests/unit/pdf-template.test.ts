import { describe, expect, it } from "vitest";

import { createCents, formatEur } from "@/lib/money";

import { renderDocumentPdf } from "@/services/pdf/render";
import {
  buildDocumentPdfLayout,
  type DocumentPdfInput,
} from "@/services/pdf/template";
import approvedLayout from "../fixtures/pdf/invoice-layout.approved.json";
import invoiceFixture from "../fixtures/pdf/invoice-multipage.json";

interface PdfDocumentLine {
  position: number;
  description: string;
  quantity: string;
  unitPriceCents: number;
  taxRate: string;
  lineSubtotalCents: number;
  lineTaxCents: number;
  lineTotalCents: number;
}

interface PdfImageElement {
  kind: "image";
  role: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PdfTextElement {
  kind: "text";
  role: string;
  text: string;
  x: number;
  y: number;
}

interface PdfTableElement {
  kind: "table";
  role: "line_table";
  headers: string[];
  rows: Array<{
    position: number;
    cells: string[];
  }>;
  x: number;
  y: number;
  width: number;
}

type PdfLayoutElement = PdfImageElement | PdfTableElement | PdfTextElement;

interface PdfLayout {
  pageSize: {
    width: number;
    height: number;
  };
  margins: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  theme: {
    accentHex: string;
    textHex: string;
    mutedHex: string;
    borderHex: string;
  };
  pages: Array<{
    elements: PdfLayoutElement[];
  }>;
}

function expandLines(): PdfDocumentLine[] {
  return Array.from(
    { length: invoiceFixture.linePattern.count },
    (_, index) => {
      const position = index + 1;
      const pattern =
        position % 2 === 1
          ? invoiceFixture.linePattern.odd
          : invoiceFixture.linePattern.even;

      return {
        position,
        description: `${invoiceFixture.linePattern.descriptionPrefix} ${position.toString().padStart(2, "0")}`,
        ...pattern,
      };
    },
  );
}

function createInput(): DocumentPdfInput {
  const { linePattern: _, ...document } = invoiceFixture;
  return {
    ...document,
    documentType: "invoice",
    currency: "EUR",
    lines: expandLines(),
  };
}

function roles(page: PdfLayout["pages"][number]): string[] {
  return page.elements.map((element) => element.role);
}

function selectedRoles(
  page: PdfLayout["pages"][number],
  expected: readonly string[],
): string[] {
  const pageRoles = new Set(roles(page));
  return expected.filter((role) => pageRoles.has(role));
}

function visibleText(layout: PdfLayout): string[] {
  return layout.pages.flatMap((page) =>
    page.elements.flatMap((element) =>
      element.kind === "text"
        ? [element.text]
        : element.kind === "table"
          ? [...element.headers, ...element.rows.flatMap((row) => row.cells)]
          : [],
    ),
  );
}

function elementByRole(layout: PdfLayout, role: string) {
  return layout.pages
    .flatMap((page) => page.elements)
    .find((element) => element.role === role);
}

function lineTables(layout: PdfLayout): PdfTableElement[] {
  return layout.pages.flatMap((page) =>
    page.elements.filter(
      (element): element is PdfTableElement => element.kind === "table",
    ),
  );
}

describe("professional invoice PDF template", () => {
  it("lays out complete issuer, client and document fiscal blocks", () => {
    const layout = buildDocumentPdfLayout(createInput()) as PdfLayout;
    const text = visibleText(layout).join("\n");

    expect(text).toContain(invoiceFixture.issuer.legalName);
    expect(text).toContain(invoiceFixture.issuer.taxId);
    expect(text).toContain(invoiceFixture.issuer.addressLines.join("\n"));
    expect(text).toContain(invoiceFixture.client.legalName);
    expect(text).toContain(invoiceFixture.client.taxId);
    expect(text).toContain(invoiceFixture.client.addressLines.join("\n"));
    expect(text).toContain(invoiceFixture.fullNumber);
    expect(text).toContain("30/07/2026");
    expect(text).toContain("29/08/2026");
  });

  it("never prints the client's email, even when the snapshot keeps it", () => {
    const layout = buildDocumentPdfLayout(createInput()) as PdfLayout;
    const text = visibleText(layout).join("\n");

    expect(text).not.toContain(invoiceFixture.client.email);
    expect(text).toContain(invoiceFixture.issuer.email);
  });

  it.each([null, "", "   \n  "])(
    "omits the notes block entirely when notes are %j",
    (notes) => {
      const layout = buildDocumentPdfLayout({
        ...createInput(),
        notes,
      }) as PdfLayout;
      const text = visibleText(layout).join("\n");

      expect(layout.pages.flatMap(roles)).not.toContain("notes");
      expect(text).not.toContain("Sin notas");
      expect(text).not.toMatch(/^Notas$/m);
    },
  );

  it("prints non-empty notes trimmed under their heading", () => {
    const layout = buildDocumentPdfLayout({
      ...createInput(),
      notes: "  Pago por transferencia a 30 días.  ",
    }) as PdfLayout;
    const notes = layout.pages
      .flatMap((page) => page.elements)
      .find((element) => element.role === "notes");

    expect(notes).toMatchObject({
      kind: "text",
      text: "Observaciones\nPago por transferencia a 30 días.",
    });
  });

  it("paginates every line exactly once and repeats the Spanish table header", () => {
    const layout = buildDocumentPdfLayout(createInput()) as PdfLayout;
    const tables = lineTables(layout);
    const positions = tables.flatMap((table) =>
      table.rows.map((row) => row.position),
    );

    expect(layout.pages.length).toBeGreaterThan(1);
    expect(tables).toHaveLength(layout.pages.length);
    expect(
      tables.every(
        (table) =>
          JSON.stringify(table.headers) ===
          JSON.stringify(approvedLayout.tableHeaders),
      ),
    ).toBe(true);
    expect(positions).toEqual(
      Array.from({ length: invoiceFixture.linePattern.count }, (_, index) => {
        return index + 1;
      }),
    );
    expect(new Set(positions).size).toBe(invoiceFixture.linePattern.count);
  });

  it("places the tax breakdown, retention and exact totals on the last page", () => {
    const layout = buildDocumentPdfLayout(createInput()) as PdfLayout;
    const lastPage = layout.pages.at(-1);

    expect(lastPage).toBeDefined();
    const text = visibleText({
      ...layout,
      pages: lastPage ? [lastPage] : [],
    }).join("\n");

    expect(text).toContain("Base imponible");
    expect(text).toContain("3.600,00 €");
    expect(text).toContain("IVA 21 %");
    expect(text).toContain("504,00 €");
    expect(text).toContain("IVA 10 %");
    expect(text).toContain("120,00 €");
    expect(text).toContain("Retención IRPF (15 %)");
    expect(text).toContain("-540,00 €");
    expect(text).toContain("Total");
    expect(text).toContain("3.684,00 €");
  });

  it("matches the approved semantic visual snapshot and Spanish labels", () => {
    const layout = buildDocumentPdfLayout(createInput()) as PdfLayout;
    const firstPage = layout.pages[0];
    const lastPage = layout.pages.at(-1);
    const text = visibleText(layout).join("\n");

    expect(layout.pageSize).toEqual(approvedLayout.pageSize);
    expect(layout.margins).toEqual(approvedLayout.margins);
    expect(layout.theme).toEqual(approvedLayout.theme);
    expect(firstPage).toBeDefined();
    expect(lastPage).toBeDefined();
    expect(
      firstPage ? selectedRoles(firstPage, approvedLayout.firstPageRoles) : [],
    ).toEqual(approvedLayout.firstPageRoles);
    expect(
      lastPage ? selectedRoles(lastPage, approvedLayout.lastPageRoles) : [],
    ).toEqual(approvedLayout.lastPageRoles);

    for (const page of layout.pages.slice(1)) {
      expect(
        selectedRoles(page, approvedLayout.continuationRequiredRoles),
      ).toEqual(approvedLayout.continuationRequiredRoles);
    }

    for (const label of approvedLayout.spanishLabels) {
      expect(text).toContain(label);
    }

    layout.pages.forEach((page, index) => {
      expect(visibleText({ ...layout, pages: [page] }).join("\n")).toContain(
        `Página ${index + 1} de ${layout.pages.length}`,
      );
    });
  });

  it("renders a valid A4 pdf-lib document with the planned page count", async () => {
    const input = createInput();
    const layout = buildDocumentPdfLayout(input) as PdfLayout;
    const bytes = await renderDocumentPdf(input);
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });

    expect(pdf.getPageCount()).toBe(layout.pages.length);
    expect(pdf.getTitle()).toBe(`Factura ${invoiceFixture.fullNumber}`);
    expect(pdf.getProducer()).toBe("Invoice Flash");

    for (const page of pdf.getPages()) {
      expect(page.getWidth()).toBeCloseTo(approvedLayout.pageSize.width, 1);
      expect(page.getHeight()).toBeCloseTo(approvedLayout.pageSize.height, 1);
    }
  });

  it("renders byte-identical output for the exact same input, regardless of when it runs", async () => {
    const input = createInput();
    const first = await renderDocumentPdf(input);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const second = await renderDocumentPdf(input);

    expect(second).toEqual(first);
  });
});

describe("proforma PDF notice", () => {
  function createProformaInput(): DocumentPdfInput {
    const { linePattern: _, ...document } = invoiceFixture;
    return {
      ...document,
      documentType: "proforma",
      fullNumber: "PRO-2026-0001",
      currency: "EUR",
      lines: [
        {
          position: 1,
          description: "Servicio de consultoría",
          quantity: "1.000",
          unitPriceCents: 10_000,
          taxRate: "21.00",
          lineSubtotalCents: 10_000,
          lineTaxCents: 2_100,
          lineTotalCents: 12_100,
        },
      ],
    };
  }

  it("titles the document Proforma and states it has no fiscal validity", () => {
    const layout = buildDocumentPdfLayout(createProformaInput()) as PdfLayout;
    const text = visibleText(layout).join("\n");

    expect(text).toContain("Proforma");
    expect(text).toContain("Documento sin validez fiscal de factura.");
  });

  it("renders a proforma for a client without tax id or address", async () => {
    const input = createProformaInput();
    const clientName = "Cliente sin datos fiscales";
    const proforma = {
      ...input,
      client: { legalName: clientName, taxId: null, addressLines: [] },
    };

    const text = visibleText(
      buildDocumentPdfLayout(proforma) as PdfLayout,
    ).join("\n");
    expect(text).toContain(clientName);
    expect(text).not.toContain("NIF: null");
    expect(text.split("\n").filter((line) => line.startsWith("NIF:"))).toEqual([
      `NIF: ${input.issuer.taxId}`,
    ]);
    expect((await renderDocumentPdf(proforma)).byteLength).toBeGreaterThan(0);
  });

  it("titles the pdf-lib document with the proforma prefix", async () => {
    const input = createProformaInput();
    const bytes = await renderDocumentPdf(input);
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });

    expect(pdf.getTitle()).toBe(`Proforma ${input.fullNumber}`);
  });
});

describe("receipt PDF layout", () => {
  function createReceiptInput(): DocumentPdfInput {
    return {
      documentType: "receipt",
      fullNumber: "REC-2026-0001",
      issueDate: "2026-09-20",
      currency: "EUR",
      issuer: invoiceFixture.issuer,
      client: invoiceFixture.client,
      lines: [],
      subtotalCents: 0,
      taxBreakdown: [],
      retentionRate: "0.00",
      retentionCents: 0,
      totalCents: 5_000,
      notes: null,
      receipt: {
        sourceInvoiceFullNumber: "2026-0001",
        paymentDate: "2026-09-20",
      },
    };
  }

  it("lays out a single page with payment details and no fiscal lines", () => {
    const layout = buildDocumentPdfLayout(createReceiptInput()) as PdfLayout;
    const text = visibleText(layout).join("\n");

    expect(layout.pages).toHaveLength(1);
    expect(lineTables(layout)).toHaveLength(0);
    expect(text).toContain("Recibo");
    expect(text).toContain(invoiceFixture.issuer.legalName);
    expect(text).toContain(invoiceFixture.client.legalName);
    expect(text).toContain("Factura relacionada");
    expect(text).toContain("2026-0001");
    expect(text).toContain("Fecha de pago");
    expect(text).toContain("20/09/2026");
    expect(text).toMatch(/Importe cobrado\s+50,00\s*€/);
    expect(text).not.toContain("Base imponible");
    expect(text).not.toContain("Retención");
  });

  it("throws when the source payment details are missing", () => {
    const input = createReceiptInput();
    input.receipt = undefined;

    expect(() => buildDocumentPdfLayout(input)).toThrow();
  });

  it("renders a single-page pdf-lib document titled with the receipt prefix", async () => {
    const input = createReceiptInput();
    const bytes = await renderDocumentPdf(input);
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });

    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toBe(`Recibo ${input.fullNumber}`);
  });
});

describe("professional document design (US6)", () => {
  it.each([
    { width: 600, height: 200, label: "wide" },
    { width: 2_000, height: 20, label: "extreme wide" },
    { width: 50, height: 900, label: "extreme tall" },
  ])(
    "scales the issuer logo into its box keeping the $label ratio",
    ({ width, height }) => {
      const input = createInput();
      const layout = buildDocumentPdfLayout({
        ...input,
        issuer: { ...input.issuer, logo: { width, height } },
      }) as PdfLayout;
      const logo = elementByRole(layout, "issuer_logo") as PdfImageElement;

      expect(logo.kind).toBe("image");
      expect(logo.width).toBeLessThanOrEqual(150);
      expect(logo.height).toBeLessThanOrEqual(48);
      expect(logo.width / logo.height).toBeCloseTo(width / height, 5);
      expect(logo.width === 150 || Math.abs(logo.height - 48) < 1e-9).toBe(
        true,
      );
      expect(elementByRole(layout, "brand")).toBeUndefined();
    },
  );

  it("places the client logo next to the client data", () => {
    const input = createInput();
    const layout = buildDocumentPdfLayout({
      ...input,
      client: { ...input.client, logo: { width: 300, height: 300 } },
    }) as PdfLayout;
    const logo = elementByRole(layout, "client_logo") as PdfImageElement;
    const heading = elementByRole(layout, "client_heading") as PdfTextElement;

    expect(logo).toMatchObject({ kind: "image", width: 36, height: 36 });
    expect(logo.x).toBe(heading.x);
    expect(logo.y).toBeGreaterThan(heading.y);
  });

  it("prints the unit next to each quantity and the tax by name", () => {
    const input = createInput();
    const [first, second, ...rest] = input.lines;
    const layout = buildDocumentPdfLayout({
      ...input,
      lines: [
        { ...(first as PdfDocumentLine), unit: "hora", taxName: "IGIC" },
        { ...(second as PdfDocumentLine), unit: null },
        ...rest,
      ],
    }) as PdfLayout;
    const [table] = lineTables(layout);

    expect(table?.headers).toEqual([
      "Concepto",
      "Cantidad",
      "Precio unitario",
      "Impuesto",
      "Total",
    ]);
    expect(table?.rows[0]?.cells[1]).toBe("1 hora");
    expect(table?.rows[0]?.cells[3]).toBe("IGIC 21 %");
    expect(table?.rows[1]?.cells[1]).toBe("1");
  });

  it("adds a payment block with due date, amount and bank details", () => {
    const layout = buildDocumentPdfLayout({
      ...createInput(),
      payment: {
        kind: "bank_account",
        label: "Cuenta principal",
        holder: "Estudio Relámpago, S.L.",
        iban: "ES9121000418450200051332",
        bic: "CAIXESBB",
      },
    }) as PdfLayout;
    const payment = elementByRole(layout, "payment") as PdfTextElement;

    expect(payment.text.split("\n")).toEqual([
      "Pago",
      `Importe: ${formatEurForTest(invoiceFixture.totalCents)}`,
      "Vencimiento: 29/08/2026",
      "Cuenta principal",
      "Titular: Estudio Relámpago, S.L.",
      "IBAN: ES91 2100 0418 4502 0005 1332",
      "BIC: CAIXESBB",
    ]);
  });

  it.each([
    [{ kind: "bizum", label: "Bizum", phone: "600123456" }, "Bizum: 600123456"],
    [
      {
        kind: "paypal",
        label: "PayPal",
        email_or_url: "pagos@estudio.example",
      },
      "PayPal: pagos@estudio.example",
    ],
    [
      { kind: "other", label: "Otro", instructions: "Pago en la tienda" },
      "Pago en la tienda",
    ],
    [{ kind: "cash", label: "Efectivo" }, "Efectivo"],
  ])("renders the %o payment variant", (payment, expected) => {
    const layout = buildDocumentPdfLayout({
      ...createInput(),
      payment,
    }) as PdfLayout;
    const block = elementByRole(layout, "payment") as PdfTextElement;
    expect(block.text).toContain(expected);
  });

  it("shows amount and due date even without a collection method, and no block for proformas", () => {
    const invoice = buildDocumentPdfLayout({
      ...createInput(),
      payment: null,
    }) as PdfLayout;
    expect((elementByRole(invoice, "payment") as PdfTextElement).text).toMatch(
      /^Pago\nImporte: /,
    );
    const proforma = buildDocumentPdfLayout({
      ...createInput(),
      documentType: "proforma",
    }) as PdfLayout;
    expect(elementByRole(proforma, "payment")).toBeUndefined();
  });

  it("renders a PDF with embedded PNG logos", async () => {
    const input = createInput();
    const bytes = await renderDocumentPdf(input, {
      issuerLogo: { bytes: TINY_PNG, format: "png" },
      clientLogo: { bytes: TINY_PNG, format: "png" },
    });
    expect(bytes.byteLength).toBeGreaterThan(1_000);
  });
});

function formatEurForTest(cents: number): string {
  return formatEur(createCents(cents));
}

// 1×1 transparent PNG.
const TINY_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  ),
  (character) => character.charCodeAt(0),
);

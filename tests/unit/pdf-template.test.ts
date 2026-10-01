import { describe, expect, it } from "vitest";

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

type PdfLayoutElement = PdfTableElement | PdfTextElement;

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
        : [...element.headers, ...element.rows.flatMap((row) => row.cells)],
    ),
  );
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
    expect(text).toContain("Documento sin validez fiscal.");
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

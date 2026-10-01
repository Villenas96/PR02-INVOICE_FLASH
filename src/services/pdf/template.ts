import { createCents, formatEur } from "@/lib/money";

export const PDF_PAGE_SIZE = {
  width: 595.28,
  height: 841.89,
} as const;

export const PDF_MARGINS = {
  top: 48,
  right: 48,
  bottom: 48,
  left: 48,
} as const;

export const PDF_THEME = {
  accentHex: "#18181B",
  textHex: "#18181B",
  mutedHex: "#71717A",
  borderHex: "#E4E4E7",
} as const;

const FIRST_PAGE_LINE_CAPACITY = 12;
const SINGLE_PAGE_LINE_CAPACITY = 8;
const CONTINUATION_LINE_CAPACITY = 25;
const LAST_PAGE_LINE_CAPACITY = 14;
const TABLE_HEADER_HEIGHT = 24;
const TABLE_ROW_HEIGHT = 22;

export interface DocumentPdfLine {
  position: number;
  description: string;
  quantity: string;
  unitPriceCents: number;
  taxRate: string;
  lineSubtotalCents: number;
  lineTaxCents: number;
  lineTotalCents: number;
}

export interface DocumentPdfParty {
  legalName: string;
  /** Always present for the issuer and for invoice clients; a proforma
   * client may lack it (proformas carry no fiscal validity). */
  taxId: string | null;
  addressLines: string[];
  email?: string | null;
}

export interface DocumentPdfReceiptDetails {
  sourceInvoiceFullNumber: string;
  paymentDate: string;
}

export interface DocumentPdfInput {
  documentType: "invoice" | "proforma" | "receipt";
  fullNumber: string;
  issueDate: string;
  dueDate?: string | null;
  currency: "EUR";
  issuer: DocumentPdfParty;
  client: DocumentPdfParty;
  lines: DocumentPdfLine[];
  subtotalCents: number;
  taxBreakdown: Array<{
    rate: string;
    baseCents: number;
    taxCents: number;
  }>;
  retentionRate: string;
  retentionCents: number;
  totalCents: number;
  notes?: string | null;
  /** Only present (and only used) for receipts. */
  receipt?: DocumentPdfReceiptDetails;
}

export interface PdfTextElement {
  kind: "text";
  role: string;
  text: string;
  x: number;
  y: number;
}

export interface PdfTableElement {
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

export type PdfLayoutElement = PdfTableElement | PdfTextElement;

export interface DocumentPdfLayout {
  pageSize: typeof PDF_PAGE_SIZE;
  margins: typeof PDF_MARGINS;
  theme: typeof PDF_THEME;
  pages: Array<{
    elements: PdfLayoutElement[];
  }>;
}

function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new TypeError("La fecha del documento debe usar YYYY-MM-DD.");
  }
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatPercentage(value: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new TypeError("El porcentaje del documento no es válido.");
  }
  return new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: 2,
  }).format(numeric);
}

function formatQuantity(value: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new TypeError("La cantidad de la línea no es válida.");
  }
  return new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: 3,
  }).format(numeric);
}

function formatMoney(value: number): string {
  return formatEur(createCents(value));
}

function partyDetails(party: DocumentPdfParty): string {
  return [
    party.legalName,
    ...(party.taxId ? [`NIF: ${party.taxId}`] : []),
    ...party.addressLines,
    ...(party.email ? [party.email] : []),
  ].join("\n");
}

function paginateLines(lines: DocumentPdfLine[]): DocumentPdfLine[][] {
  if (lines.length === 0) {
    throw new RangeError("El PDF debe contener al menos una línea.");
  }
  if (lines.length <= SINGLE_PAGE_LINE_CAPACITY) {
    return [lines];
  }

  const firstPageCount =
    lines.length <= FIRST_PAGE_LINE_CAPACITY
      ? SINGLE_PAGE_LINE_CAPACITY
      : FIRST_PAGE_LINE_CAPACITY;
  const pages = [lines.slice(0, firstPageCount)];
  let cursor = firstPageCount;

  while (lines.length - cursor > LAST_PAGE_LINE_CAPACITY) {
    const remaining = lines.length - cursor;
    const pageSize = Math.min(
      CONTINUATION_LINE_CAPACITY,
      remaining - LAST_PAGE_LINE_CAPACITY,
    );
    pages.push(lines.slice(cursor, cursor + pageSize));
    cursor += pageSize;
  }

  pages.push(lines.slice(cursor));
  return pages;
}

function lineTable(lines: DocumentPdfLine[], y: number): PdfTableElement {
  return {
    kind: "table",
    role: "line_table",
    headers: ["Concepto", "Cantidad", "Precio unitario", "IVA", "Total"],
    rows: lines.map((line) => ({
      position: line.position,
      cells: [
        line.description,
        formatQuantity(line.quantity),
        formatMoney(line.unitPriceCents),
        `${formatPercentage(line.taxRate)} %`,
        formatMoney(line.lineTotalCents),
      ],
    })),
    x: PDF_MARGINS.left,
    y,
    width: PDF_PAGE_SIZE.width - PDF_MARGINS.left - PDF_MARGINS.right,
  };
}

function pageFooter(page: number, pageCount: number): PdfTextElement {
  return {
    kind: "text",
    role: "page_footer",
    text: `Página ${page} de ${pageCount}`,
    x: PDF_MARGINS.left,
    y: 28,
  };
}

function taxBreakdownText(input: DocumentPdfInput): string {
  return input.taxBreakdown
    .map(
      (entry) =>
        `IVA ${formatPercentage(entry.rate)} %    ${formatMoney(entry.taxCents)}`,
    )
    .join("\n");
}

function totalsText(input: DocumentPdfInput): string {
  return [
    `Base imponible    ${formatMoney(input.subtotalCents)}`,
    `Retención IRPF (${formatPercentage(input.retentionRate)} %)    -${formatMoney(input.retentionCents)}`,
    `Total    ${formatMoney(input.totalCents)}`,
  ].join("\n");
}

export function documentTitle(
  documentType: DocumentPdfInput["documentType"],
): string {
  if (documentType === "invoice") {
    return "Factura";
  }
  if (documentType === "proforma") {
    return "Proforma";
  }
  return "Recibo";
}

function buildReceiptPdfLayout(input: DocumentPdfInput): DocumentPdfLayout {
  const receipt = input.receipt;
  if (!receipt) {
    throw new Error("Falta la información de pago para el PDF del recibo.");
  }

  const title = documentTitle("receipt");
  const elements: PdfLayoutElement[] = [
    {
      kind: "text",
      role: "brand",
      text: "INVOICE FLASH",
      x: PDF_MARGINS.left,
      y: 790,
    },
    {
      kind: "text",
      role: "document_title",
      text: title,
      x: PDF_MARGINS.left,
      y: 744,
    },
    {
      kind: "text",
      role: "document_number",
      text: `${title} ${input.fullNumber}`,
      x: PDF_PAGE_SIZE.width - PDF_MARGINS.right,
      y: 752,
    },
    {
      kind: "text",
      role: "issuer_heading",
      text: "Emisor",
      x: PDF_MARGINS.left,
      y: 686,
    },
    {
      kind: "text",
      role: "issuer_details",
      text: partyDetails(input.issuer),
      x: PDF_MARGINS.left,
      y: 666,
    },
    {
      kind: "text",
      role: "client_heading",
      text: "Cliente",
      x: 310,
      y: 686,
    },
    {
      kind: "text",
      role: "client_details",
      text: partyDetails(input.client),
      x: 310,
      y: 666,
    },
    {
      kind: "text",
      role: "receipt_invoice_reference",
      text: `Factura relacionada\n${receipt.sourceInvoiceFullNumber}`,
      x: PDF_MARGINS.left,
      y: 558,
    },
    {
      kind: "text",
      role: "receipt_payment_date",
      text: `Fecha de pago\n${formatDate(receipt.paymentDate)}`,
      x: 310,
      y: 558,
    },
    {
      kind: "text",
      role: "totals",
      text: `Importe cobrado    ${formatMoney(input.totalCents)}`,
      x: PDF_MARGINS.left,
      y: 480,
    },
    pageFooter(1, 1),
  ];

  return {
    pageSize: PDF_PAGE_SIZE,
    margins: PDF_MARGINS,
    theme: PDF_THEME,
    pages: [{ elements }],
  };
}

export function buildDocumentPdfLayout(
  input: DocumentPdfInput,
): DocumentPdfLayout {
  if (input.currency !== "EUR") {
    throw new RangeError("El renderizador v1 solo admite importes en EUR.");
  }

  if (input.documentType === "receipt") {
    return buildReceiptPdfLayout(input);
  }

  const linePages = paginateLines(input.lines);
  const pageCount = linePages.length;
  const title = documentTitle(input.documentType);
  const pages = linePages.map((pageLines, pageIndex) => {
    const isFirstPage = pageIndex === 0;
    const isLastPage = pageIndex === pageCount - 1;
    const tableY = isFirstPage ? 500 : 746;
    const elements: PdfLayoutElement[] = [];

    if (isFirstPage) {
      elements.push(
        {
          kind: "text",
          role: "brand",
          text: "INVOICE FLASH",
          x: PDF_MARGINS.left,
          y: 790,
        },
        {
          kind: "text",
          role: "document_title",
          text: title,
          x: PDF_MARGINS.left,
          y: 744,
        },
      );

      if (input.documentType === "proforma") {
        elements.push({
          kind: "text",
          role: "fiscal_notice",
          text: "Documento sin validez fiscal.",
          x: PDF_MARGINS.left,
          y: 724,
        });
      }
    }

    elements.push({
      kind: "text",
      role: "document_number",
      text: `${title} ${input.fullNumber}`,
      x: PDF_PAGE_SIZE.width - PDF_MARGINS.right,
      y: isFirstPage ? 752 : 790,
    });

    if (isFirstPage) {
      elements.push(
        {
          kind: "text",
          role: "issuer_heading",
          text: "Emisor",
          x: PDF_MARGINS.left,
          y: 686,
        },
        {
          kind: "text",
          role: "issuer_details",
          text: partyDetails(input.issuer),
          x: PDF_MARGINS.left,
          y: 666,
        },
        {
          kind: "text",
          role: "client_heading",
          text: "Cliente",
          x: 310,
          y: 686,
        },
        {
          kind: "text",
          role: "client_details",
          text: partyDetails(input.client),
          x: 310,
          y: 666,
        },
        {
          kind: "text",
          role: "issue_date",
          text: `Fecha de emisión\n${formatDate(input.issueDate)}`,
          x: PDF_MARGINS.left,
          y: 558,
        },
        {
          kind: "text",
          role: "due_date",
          text: `Fecha de vencimiento\n${input.dueDate ? formatDate(input.dueDate) : "-"}`,
          x: 310,
          y: 558,
        },
      );
    }

    elements.push(lineTable(pageLines, tableY));

    if (isLastPage) {
      const tableBottom =
        tableY - TABLE_HEADER_HEIGHT - pageLines.length * TABLE_ROW_HEIGHT;
      const summaryY = tableBottom - 30;
      const totalsY =
        summaryY - Math.max(input.taxBreakdown.length, 1) * 14 - 18;
      elements.push(
        {
          kind: "text",
          role: "tax_breakdown",
          text: taxBreakdownText(input),
          x: 310,
          y: summaryY,
        },
        {
          kind: "text",
          role: "totals",
          text: totalsText(input),
          x: 310,
          y: totalsY,
        },
        {
          kind: "text",
          role: "notes",
          text: `Notas\n${input.notes?.trim() || "Sin notas."}`,
          x: PDF_MARGINS.left,
          y: Math.min(totalsY - 76, 170),
        },
      );
    }

    elements.push(pageFooter(pageIndex + 1, pageCount));
    return { elements };
  });

  return {
    pageSize: PDF_PAGE_SIZE,
    margins: PDF_MARGINS,
    theme: PDF_THEME,
    pages,
  };
}

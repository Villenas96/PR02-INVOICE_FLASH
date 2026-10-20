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
  /** Printed next to the quantity when present (FR-030). */
  unit?: string | null;
  unitPriceCents: number;
  taxRate: string;
  /** Frozen tax name; documents issued before tax types were IVA. */
  taxName?: string;
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
  /** Printed for the issuer only: documents never show the client's email
   * (FR-006), even though the client snapshot keeps it for sending. */
  email?: string | null;
  /** Intrinsic size of the embedded logo, when there is one. */
  logo?: { width: number; height: number } | null;
}

/** Collection method frozen at issue (FR-022, FR-026). */
export interface DocumentPdfPayment {
  kind: string;
  label: string;
  holder?: string;
  iban?: string;
  bic?: string;
  phone?: string;
  email_or_url?: string;
  instructions?: string;
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
  /** `name` is missing on documents issued before tax types existed:
   * they were all IVA. */
  taxBreakdown: Array<{
    name?: string;
    rate: string;
    baseCents: number;
    taxCents: number;
  }>;
  retentionRate: string;
  retentionCents: number;
  totalCents: number;
  notes?: string | null;
  /** Invoices only: frozen collection method for the payment block. */
  payment?: DocumentPdfPayment | null;
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

export interface PdfImageElement {
  kind: "image";
  role: "issuer_logo" | "client_logo";
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PdfLayoutElement =
  | PdfImageElement
  | PdfTableElement
  | PdfTextElement;

const ISSUER_LOGO_BOX = { width: 150, height: 48, top: 805 } as const;
const CLIENT_LOGO_BOX = { width: 110, height: 36, top: 740 } as const;
const WRAP_CHARACTERS = 52;

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

function partyDetails(
  party: DocumentPdfParty,
  { includeEmail }: { includeEmail: boolean },
): string {
  return [
    party.legalName,
    ...(party.taxId ? [`NIF: ${party.taxId}`] : []),
    ...party.addressLines,
    ...(includeEmail && party.email ? [party.email] : []),
  ].join("\n");
}

function issuerDetails(party: DocumentPdfParty): string {
  return partyDetails(party, { includeEmail: true });
}

function clientDetails(party: DocumentPdfParty): string {
  return partyDetails(party, { includeEmail: false });
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

/** Fits an image inside a box without distorting it (R10, scaleToFit). */
export function scaleToFit(
  size: { width: number; height: number },
  box: { width: number; height: number },
): { width: number; height: number } {
  const ratio = Math.min(box.width / size.width, box.height / size.height);
  return { width: size.width * ratio, height: size.height * ratio };
}

function logoElement(
  role: PdfImageElement["role"],
  logo: { width: number; height: number },
  box: { width: number; height: number; top: number },
  x: number,
): PdfImageElement {
  const size = scaleToFit(logo, box);
  return { kind: "image", role, x, y: box.top - size.height, ...size };
}

function wrapText(text: string, width = WRAP_CHARACTERS): string[] {
  return text.split("\n").flatMap((paragraph) => {
    const lines: string[] = [];
    let current = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (current && `${current} ${word}`.length > width) {
        lines.push(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
    lines.push(current);
    return lines;
  });
}

function formatIban(iban: string): string {
  return iban.replace(/(.{4})(?=.)/g, "$1 ");
}

function paymentText(input: DocumentPdfInput): string {
  const lines = [
    "Pago",
    `Importe: ${formatMoney(input.totalCents)}`,
    ...(input.dueDate ? [`Vencimiento: ${formatDate(input.dueDate)}`] : []),
  ];
  const payment = input.payment;
  if (payment) {
    switch (payment.kind) {
      case "bank_account":
        lines.push(
          payment.label,
          ...(payment.holder ? [`Titular: ${payment.holder}`] : []),
          ...(payment.iban ? [`IBAN: ${formatIban(payment.iban)}`] : []),
          ...(payment.bic ? [`BIC: ${payment.bic}`] : []),
        );
        break;
      case "bizum":
        lines.push(`Bizum: ${payment.phone ?? ""}`.trim());
        break;
      case "paypal":
        lines.push(`PayPal: ${payment.email_or_url ?? ""}`.trim());
        break;
      case "cash":
        lines.push("Efectivo");
        break;
      default:
        lines.push(
          payment.label,
          ...wrapText(payment.instructions ?? "").filter(Boolean),
        );
    }
  }
  return lines.join("\n");
}

function lineTable(lines: DocumentPdfLine[], y: number): PdfTableElement {
  return {
    kind: "table",
    role: "line_table",
    headers: ["Concepto", "Cantidad", "Precio unitario", "Impuesto", "Total"],
    rows: lines.map((line) => ({
      position: line.position,
      cells: [
        line.description,
        line.unit
          ? `${formatQuantity(line.quantity)} ${line.unit}`
          : formatQuantity(line.quantity),
        formatMoney(line.unitPriceCents),
        `${line.taxName ?? "IVA"} ${formatPercentage(line.taxRate)} %`,
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
        `${entry.name ?? "IVA"} ${formatPercentage(entry.rate)} %    ${formatMoney(entry.taxCents)}`,
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
      text: issuerDetails(input.issuer),
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
      text: clientDetails(input.client),
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
      // The issuer's logo heads the document (FR-024); without one, the
      // product wordmark keeps its place.
      elements.push(
        input.issuer.logo
          ? logoElement(
              "issuer_logo",
              input.issuer.logo,
              ISSUER_LOGO_BOX,
              PDF_MARGINS.left,
            )
          : {
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
      if (input.client.logo) {
        elements.push(
          logoElement("client_logo", input.client.logo, CLIENT_LOGO_BOX, 310),
        );
      }

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
          text: issuerDetails(input.issuer),
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
          text: clientDetails(input.client),
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
      );
      const footerY = Math.min(totalsY - 60, 200);
      // FR-026: invoices end with a payment block (amount, due date and the
      // frozen collection method).
      if (input.documentType === "invoice") {
        elements.push({
          kind: "text",
          role: "payment",
          text: paymentText(input),
          x: PDF_MARGINS.left,
          y: footerY,
        });
      }
      // FR-005: no observations box at all when there are no notes.
      const notes = input.notes?.trim();
      if (notes) {
        elements.push({
          kind: "text",
          role: "notes",
          text: `Observaciones\n${wrapText(notes).join("\n")}`,
          x: input.documentType === "invoice" ? 310 : PDF_MARGINS.left,
          y: footerY,
        });
      }
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

import {
  PDFDocument,
  type PDFFont,
  type PDFPage,
  rgb,
  StandardFonts,
} from "pdf-lib";

import {
  buildDocumentPdfLayout,
  type DocumentPdfInput,
  documentTitle,
  type PdfTableElement,
  type PdfTextElement,
} from "./template";

const TABLE_HEADER_HEIGHT = 24;
const TABLE_ROW_HEIGHT = 22;
const TABLE_COLUMN_WIDTHS = [235, 55, 85, 50, 74.28] as const;

function colorFromHex(value: string) {
  const match = /^#([\dA-F]{2})([\dA-F]{2})([\dA-F]{2})$/i.exec(value);
  if (!match) {
    throw new TypeError(`Color hexadecimal no válido: ${value}`);
  }
  return rgb(
    Number.parseInt(match[1] ?? "0", 16) / 255,
    Number.parseInt(match[2] ?? "0", 16) / 255,
    Number.parseInt(match[3] ?? "0", 16) / 255,
  );
}

function normalizePdfText(value: string): string {
  return value
    .replaceAll("\u2011", "-")
    .replaceAll("\u2013", "-")
    .replaceAll("\u2014", "-");
}

function truncateText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string {
  const normalized = normalizePdfText(text);
  if (font.widthOfTextAtSize(normalized, size) <= maxWidth) {
    return normalized;
  }

  let result = normalized;
  while (
    result.length > 1 &&
    font.widthOfTextAtSize(`${result}...`, size) > maxWidth
  ) {
    result = result.slice(0, -1);
  }
  return `${result.trimEnd()}...`;
}

function textStyle(element: PdfTextElement, regular: PDFFont, bold: PDFFont) {
  switch (element.role) {
    case "brand":
      return { font: bold, size: 9, lineHeight: 11, align: "left" as const };
    case "document_title":
      return { font: bold, size: 30, lineHeight: 32, align: "left" as const };
    case "document_number":
      return { font: bold, size: 10, lineHeight: 12, align: "right" as const };
    case "issuer_heading":
    case "client_heading":
      return { font: bold, size: 9, lineHeight: 11, align: "left" as const };
    case "page_footer":
      return { font: regular, size: 8, lineHeight: 10, align: "left" as const };
    case "totals":
      return { font: bold, size: 10, lineHeight: 18, align: "left" as const };
    case "notes":
      return { font: regular, size: 9, lineHeight: 13, align: "left" as const };
    default:
      return { font: regular, size: 9, lineHeight: 13, align: "left" as const };
  }
}

function drawTextElement(
  page: PDFPage,
  element: PdfTextElement,
  regular: PDFFont,
  bold: PDFFont,
  colors: {
    text: ReturnType<typeof rgb>;
    muted: ReturnType<typeof rgb>;
  },
): void {
  const style = textStyle(element, regular, bold);
  const color =
    element.role.endsWith("_heading") ||
    element.role === "page_footer" ||
    element.role === "brand" ||
    element.role === "fiscal_notice"
      ? colors.muted
      : colors.text;
  const lines = normalizePdfText(element.text).split("\n");

  lines.forEach((line, index) => {
    const width = style.font.widthOfTextAtSize(line, style.size);
    const x = style.align === "right" ? element.x - width : element.x;
    page.drawText(line, {
      x,
      y: element.y - index * style.lineHeight,
      font: style.font,
      size: style.size,
      color,
    });
  });
}

function drawTable(
  page: PDFPage,
  table: PdfTableElement,
  regular: PDFFont,
  bold: PDFFont,
  colors: {
    accent: ReturnType<typeof rgb>;
    text: ReturnType<typeof rgb>;
    muted: ReturnType<typeof rgb>;
    border: ReturnType<typeof rgb>;
  },
): void {
  page.drawRectangle({
    x: table.x,
    y: table.y - TABLE_HEADER_HEIGHT,
    width: table.width,
    height: TABLE_HEADER_HEIGHT,
    color: colors.accent,
  });

  let columnX = table.x;
  table.headers.forEach((header, index) => {
    const columnWidth = TABLE_COLUMN_WIDTHS[index] ?? 0;
    const alignRight = index > 0;
    const text = truncateText(header, bold, 8, columnWidth - 12);
    const textWidth = bold.widthOfTextAtSize(text, 8);
    page.drawText(text, {
      x: alignRight ? columnX + columnWidth - textWidth - 6 : columnX + 6,
      y: table.y - 16,
      font: bold,
      size: 8,
      color: rgb(1, 1, 1),
    });
    columnX += columnWidth;
  });

  table.rows.forEach((row, rowIndex) => {
    const rowTop = table.y - TABLE_HEADER_HEIGHT - rowIndex * TABLE_ROW_HEIGHT;
    const rowBottom = rowTop - TABLE_ROW_HEIGHT;
    if (rowIndex % 2 === 1) {
      page.drawRectangle({
        x: table.x,
        y: rowBottom,
        width: table.width,
        height: TABLE_ROW_HEIGHT,
        color: rgb(0.98, 0.98, 0.985),
      });
    }
    page.drawLine({
      start: { x: table.x, y: rowBottom },
      end: { x: table.x + table.width, y: rowBottom },
      thickness: 0.6,
      color: colors.border,
    });

    let cellX = table.x;
    row.cells.forEach((cell, cellIndex) => {
      const columnWidth = TABLE_COLUMN_WIDTHS[cellIndex] ?? 0;
      const alignRight = cellIndex > 0;
      const text = truncateText(cell, regular, 8, columnWidth - 12);
      const textWidth = regular.widthOfTextAtSize(text, 8);
      page.drawText(text, {
        x: alignRight ? cellX + columnWidth - textWidth - 6 : cellX + 6,
        y: rowBottom + 7,
        font: regular,
        size: 8,
        color: cellIndex === 0 ? colors.text : colors.muted,
      });
      cellX += columnWidth;
    });
  });
}

export async function renderDocumentPdf(
  input: DocumentPdfInput,
): Promise<Uint8Array> {
  const layout = buildDocumentPdfLayout(input);
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const colors = {
    accent: colorFromHex(layout.theme.accentHex),
    text: colorFromHex(layout.theme.textHex),
    muted: colorFromHex(layout.theme.mutedHex),
    border: colorFromHex(layout.theme.borderHex),
  };

  document.setTitle(`${documentTitle(input.documentType)} ${input.fullNumber}`);
  document.setAuthor("Invoice Flash");
  document.setCreator("Invoice Flash");
  document.setProducer("Invoice Flash");
  document.setSubject("Documento de facturación");
  // Derived from the document's own data (never the wall clock) so that
  // re-rendering the exact same input — e.g. from an immutable issued
  // snapshot — always produces byte-identical output.
  const referenceDate = new Date(`${input.issueDate}T00:00:00.000Z`);
  document.setCreationDate(referenceDate);
  document.setModificationDate(referenceDate);

  for (const pageLayout of layout.pages) {
    const page = document.addPage([
      layout.pageSize.width,
      layout.pageSize.height,
    ]);

    for (const element of pageLayout.elements) {
      if (element.kind === "table") {
        drawTable(page, element, regular, bold, colors);
      } else {
        drawTextElement(page, element, regular, bold, colors);
      }
    }
  }

  return document.save({ useObjectStreams: false });
}

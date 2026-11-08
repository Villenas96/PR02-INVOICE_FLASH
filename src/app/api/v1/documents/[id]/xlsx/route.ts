import { z } from "zod";

import { createDatabase } from "@/db";
import { ApiError } from "@/lib/api/errors";
import { runRoute } from "@/lib/api/route";
import { validate } from "@/lib/api/validate";
import { buildDocumentSheet } from "@/lib/exports/document-sheet";
import { writeWorkbook, XLSX_CONTENT_TYPE } from "@/lib/exports/xlsx";
import { resolveCompanyContext } from "@/services/context";
import { type DocumentDetail, getDocumentDetail } from "@/services/documents";
import { requireFeature } from "@/services/entitlements";

const paramsSchema = z.object({ id: z.string().uuid() }).strict();

interface PartySnapshot {
  legalName?: string;
  name?: string;
  taxId?: string | null;
  address?: string | null;
}

function party(snapshot: unknown) {
  const value = (snapshot ?? {}) as PartySnapshot;
  return {
    name: value.legalName ?? value.name ?? "",
    taxId: value.taxId ?? null,
    address: value.address ?? null,
  };
}

/**
 * Spreadsheet of one issued document (FR-027, Pro). Generated in the request:
 * bounded by the editor's line limit and well under 50 ms (research R12).
 */
export async function GET(
  request: Request,
  routeContext: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runRoute(request, "documents.xlsx_failed", async () => {
    const [context, params] = await Promise.all([
      resolveCompanyContext(request, { access: "read" }),
      routeContext.params.then((value) => validate(paramsSchema, value)),
    ]);
    requireFeature(context, "document_xlsx");
    const document = await getDocumentDetail<DocumentDetail>({
      database: createDatabase(),
      companyId: context.companyId,
      documentId: params.id,
    });
    if (document.status === "draft" || !document.fullNumber) {
      throw new ApiError(
        "conflict",
        409,
        "Emite el documento para descargarlo en hoja de cálculo.",
      );
    }
    const sheet = buildDocumentSheet({
      documentType: document.documentType,
      fullNumber: document.fullNumber,
      issueDate: document.issueDate,
      dueDate: document.dueDate,
      issuer: party(document.issuerSnapshot),
      client: party(document.clientSnapshot),
      lines: document.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unitPriceCents: line.unitPriceCents,
        taxName: line.taxName,
        taxRate: line.taxRate,
        lineSubtotalCents: line.lineSubtotalCents,
        lineTaxCents: line.lineTaxCents,
        lineTotalCents: line.lineTotalCents,
      })),
      taxBreakdown: document.taxBreakdown as Array<{
        name?: string;
        rate: string;
        baseCents: number;
        taxCents: number;
      }>,
      subtotalCents: document.subtotalCents,
      retentionRate: document.retentionRate,
      retentionCents: document.retentionCents,
      totalCents: document.totalCents,
    });
    const bytes = writeWorkbook([
      {
        name: document.fullNumber,
        rows: sheet.rows,
        moneyCells: sheet.moneyCells,
      },
    ]);
    const filename = `${document.fullNumber.replace(/[^\w.-]+/g, "-")}.xlsx`;
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  });
}

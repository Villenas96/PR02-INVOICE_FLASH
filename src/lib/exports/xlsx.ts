import { utils, write } from "xlsx";

import type { SheetValue } from "@/lib/exports/document-sheet";

export const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MONEY_FORMAT = '#,##0.00 "€"';

/** Writes rows to an .xlsx workbook, formatting the given money cells. */
export function writeWorkbook(
  sheets: Array<{
    name: string;
    rows: SheetValue[][];
    moneyCells?: Array<[number, number]>;
  }>,
): Uint8Array<ArrayBuffer> {
  const workbook = utils.book_new();
  for (const sheet of sheets) {
    const worksheet = utils.aoa_to_sheet(sheet.rows);
    for (const [row, column] of sheet.moneyCells ?? []) {
      const cell = worksheet[utils.encode_cell({ r: row, c: column })];
      if (cell && typeof cell.v === "number") {
        cell.z = MONEY_FORMAT;
      }
    }
    utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31));
  }
  return new Uint8Array(write(workbook, { type: "array", bookType: "xlsx" }));
}

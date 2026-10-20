/**
 * CSV bytes → text (research R13). Spreadsheet exports in Spain are either
 * UTF-8 (often with BOM) or Windows-1252 (Excel «CSV (delimitado por comas)»):
 * UTF-8 is tried strictly first and anything invalid falls back.
 */

export type CsvEncoding = "utf-8" | "windows-1252";

export function decodeCsvBytes(bytes: Uint8Array): {
  text: string;
  encoding: CsvEncoding;
} {
  let text: string;
  let encoding: CsvEncoding;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    encoding = "utf-8";
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
    encoding = "windows-1252";
  }
  return { text: text.replace(/^﻿/u, ""), encoding };
}

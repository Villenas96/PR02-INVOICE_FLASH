/** Messages for archived data found while duplicating (FR-018). */
export const DUPLICATE_WARNING_TEXTS: Record<string, string> = {
  client_archived:
    "El cliente original está archivado: elige otro o restáuralo antes de emitir.",
  product_archived:
    "Algún producto está archivado: las líneas conservan sus datos, pero ya no están vinculadas al catálogo.",
  tax_archived:
    "Algún impuesto está archivado: revisa el impuesto de las líneas antes de emitir.",
};

export function duplicateWarningTexts(value: unknown): string[] {
  return typeof value === "string"
    ? value
        .split(",")
        .flatMap((warning) =>
          DUPLICATE_WARNING_TEXTS[warning]
            ? [DUPLICATE_WARNING_TEXTS[warning]]
            : [],
        )
    : [];
}

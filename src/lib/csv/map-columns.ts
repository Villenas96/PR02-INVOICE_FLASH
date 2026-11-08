/** Catalog fields an import column can map to (FR-031). */
export const CATALOG_IMPORT_FIELDS = [
  "description",
  "unit_price",
  "tax_rate",
  "unit",
] as const;
export type CatalogImportField = (typeof CATALOG_IMPORT_FIELDS)[number];
export const REQUIRED_CATALOG_FIELDS: readonly CatalogImportField[] = [
  "description",
  "unit_price",
];

/** Column index per field; `null` = not imported. */
export type CatalogMapping = Record<CatalogImportField, number | null>;

export const CATALOG_FIELD_LABELS: Record<CatalogImportField, string> = {
  description: "Descripción",
  unit_price: "Precio",
  tax_rate: "Impuesto (%)",
  unit: "Unidad",
};

const SYNONYMS: Record<CatalogImportField, readonly string[]> = {
  description: [
    "descripcion",
    "concepto",
    "producto",
    "servicio",
    "nombre",
    "articulo",
    "description",
    "name",
    "item",
  ],
  unit_price: [
    "precio",
    "precio unitario",
    "precio sin iva",
    "importe",
    "pvp",
    "tarifa",
    "price",
    "unit price",
  ],
  tax_rate: [
    "iva",
    "impuesto",
    "tipo iva",
    "tipo de iva",
    "iva %",
    "tipo impositivo",
    "tax",
    "vat",
  ],
  unit: ["unidad", "unidades", "medida", "unidad de medida", "unit"],
};

export function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .trim();
}

/** Suggests a column per field by header name; each column used once. */
export function suggestCatalogMapping(
  headers: readonly string[],
): CatalogMapping {
  const normalized = headers.map(normalizeHeader);
  const used = new Set<number>();
  const mapping = {} as CatalogMapping;
  for (const field of CATALOG_IMPORT_FIELDS) {
    const synonyms = SYNONYMS[field];
    let match = normalized.findIndex(
      (header, index) => !used.has(index) && synonyms.includes(header),
    );
    if (match < 0) {
      match = normalized.findIndex(
        (header, index) =>
          !used.has(index) &&
          synonyms.some((synonym) => header.startsWith(synonym)),
      );
    }
    mapping[field] = match >= 0 ? match : null;
    if (match >= 0) {
      used.add(match);
    }
  }
  return mapping;
}

/** Required fields without a column, for an actionable message. */
export function missingRequiredFields(
  mapping: CatalogMapping,
): CatalogImportField[] {
  return REQUIRED_CATALOG_FIELDS.filter((field) => mapping[field] === null);
}

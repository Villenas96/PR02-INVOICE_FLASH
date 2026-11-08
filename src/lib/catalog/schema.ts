import { z } from "zod";

const MAX_POSTGRES_INTEGER = 2_147_483_647;

/** Catalog item fields shared by the API and the CSV import (FR-031). */
export const catalogDescriptionSchema = z
  .string()
  .trim()
  .min(1, "Indica una descripción para el concepto.")
  .max(1_000, "La descripción no puede superar 1.000 caracteres.");

export const catalogUnitPriceCentsSchema = z
  .number()
  .int("El precio debe ser un entero en céntimos.")
  .min(0, "El precio no puede ser negativo.")
  .max(MAX_POSTGRES_INTEGER, "El precio supera el importe máximo permitido.");

export const catalogUnitSchema = z
  .string()
  .trim()
  .max(20)
  .nullable()
  .optional();

export const createCatalogItemSchema = z
  .object({
    description: catalogDescriptionSchema,
    unit_price_cents: catalogUnitPriceCentsSchema,
    tax_rate: z
      .union([z.string(), z.number()])
      .transform((value) => String(value))
      .optional(),
    tax_rate_id: z.string().uuid().nullable().optional(),
    unit: catalogUnitSchema,
  })
  .strict();

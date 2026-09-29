import { z } from "zod";

import { validate } from "./validate";

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

const paginationSchema = z.object({
  cursor: z.string().min(1).max(256).optional(),
  limit: z.coerce
    .number()
    .int("El límite debe ser un número entero.")
    .min(1, "El límite debe estar entre 1 y 100.")
    .max(MAX_PAGE_SIZE, "El límite máximo es 100.")
    .default(DEFAULT_PAGE_SIZE),
});

export type Pagination = z.output<typeof paginationSchema>;

export function parsePagination(searchParams: URLSearchParams): Pagination {
  return validate(paginationSchema, Object.fromEntries(searchParams.entries()));
}

import { z } from "zod";

import { ApiError } from "./errors";
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

const idCursorSchema = z.object({ v: z.literal(1), id: z.string().uuid() });

function toBase64Url(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

/** Opaque cursor over a time-ordered (UUIDv7) id. */
export function encodeIdCursor(id: string): string {
  return toBase64Url(JSON.stringify({ v: 1, id }));
}

export function decodeIdCursor(cursor: string | undefined): string | undefined {
  if (!cursor) {
    return undefined;
  }
  try {
    const base64 = cursor.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      "=",
    );
    const bytes = Uint8Array.from(atob(padded), (character) =>
      character.charCodeAt(0),
    );
    return idCursorSchema.parse(JSON.parse(new TextDecoder().decode(bytes))).id;
  } catch {
    throw new ApiError(
      "validation_error",
      400,
      "El cursor de paginación no es válido.",
    );
  }
}

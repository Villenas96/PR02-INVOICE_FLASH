import { ApiError } from "@/lib/api/errors";

/** Issuing (or choosing) an archived series (contracts/api.md). */
export function seriesArchivedError(): ApiError {
  return new ApiError(
    "series_archived",
    409,
    "La serie elegida está archivada. Elige otra serie activa o restáurala en Ajustes.",
  );
}

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { measurementUnits } from "@/db/schema/measurement-unit";
import { ApiError } from "@/lib/api/errors";
import { createUuidV7 } from "@/lib/ids";
import {
  isPredefinedUnit,
  MAX_UNIT_LENGTH,
  normalizeUnit,
  PREDEFINED_UNITS,
} from "@/lib/units";

export interface UnitsResponse {
  predefined: string[];
  custom: Array<{ id: string; name: string }>;
}

export async function listUnits(
  database: Database,
  companyId: string,
): Promise<UnitsResponse> {
  const custom = await database
    .select({ id: measurementUnits.id, name: measurementUnits.name })
    .from(measurementUnits)
    .where(
      and(
        eq(measurementUnits.companyId, companyId),
        isNull(measurementUnits.archivedAt),
      ),
    )
    .orderBy(asc(measurementUnits.name));
  return { predefined: [...PREDEFINED_UNITS], custom };
}

/**
 * Adds a company unit (FR-030). Names are unique per company ignoring case;
 * asking again for an existing or predefined unit returns it unchanged.
 */
export async function createUnit(
  database: Database,
  companyId: string,
  rawName: string,
  now = new Date(),
): Promise<{ id: string | null; name: string; created: boolean }> {
  const name = normalizeUnit(rawName);
  if (!name || name.length > MAX_UNIT_LENGTH) {
    throw new ApiError(
      "validation_error",
      400,
      `La unidad debe tener entre 1 y ${MAX_UNIT_LENGTH} caracteres.`,
      { name: "Indica una unidad más corta." },
    );
  }
  if (isPredefinedUnit(name)) {
    return { id: null, name: name.toLocaleLowerCase("es"), created: false };
  }
  const [inserted] = await database
    .insert(measurementUnits)
    .values({
      id: createUuidV7(now.getTime()),
      companyId,
      name,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: measurementUnits.id, name: measurementUnits.name });
  if (inserted) {
    return { ...inserted, created: true };
  }
  const [existing] = await database
    .select({ id: measurementUnits.id, name: measurementUnits.name })
    .from(measurementUnits)
    .where(
      and(
        eq(measurementUnits.companyId, companyId),
        sql`lower(${measurementUnits.name}) = lower(${name})`,
      ),
    )
    .limit(1);
  return {
    id: existing?.id ?? null,
    name: existing?.name ?? name,
    created: false,
  };
}

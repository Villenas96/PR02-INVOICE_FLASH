import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@/db";
import { collectionMethods } from "@/db/schema/collection-method";
import { runStatements } from "@/db/transaction";
import { ApiError, ResourceNotFoundError } from "@/lib/api/errors";
import { IBAN_ERROR_MESSAGE, isValidBic, validateIban } from "@/lib/iban";
import { createUuidV7 } from "@/lib/ids";

export type CollectionMethodRow = typeof collectionMethods.$inferSelect;
export type CollectionMethodKind = CollectionMethodRow["kind"];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value ? value : null));

const PHONE_PATTERN = /^\+?[0-9][0-9 ]{7,17}$/;

export const collectionMethodInputSchema = z
  .object({
    kind: z.enum(["bank_account", "bizum", "paypal", "cash", "other"]),
    label: z
      .string()
      .trim()
      .min(1, "Pon un alias al método de cobro.")
      .max(60, "El alias no puede superar 60 caracteres."),
    holder_name: optionalText(120),
    iban: optionalText(42),
    bic: optionalText(11),
    phone: optionalText(20),
    email_or_url: optionalText(320),
    instructions: optionalText(300),
    is_default: z.boolean().optional(),
  })
  .strict();

export type CollectionMethodInput = z.output<
  typeof collectionMethodInputSchema
>;

interface MethodFields {
  holderName: string | null;
  iban: string | null;
  bic: string | null;
  phone: string | null;
  emailOrUrl: string | null;
  instructions: string | null;
}

/**
 * Kind-specific rules (FR-021). Only the fields of the kind are kept; the
 * IBAN error never echoes the value (research R5).
 */
export function validateMethodFields(
  kind: CollectionMethodKind,
  input: {
    holder_name: string | null;
    iban: string | null;
    bic: string | null;
    phone: string | null;
    email_or_url: string | null;
    instructions: string | null;
  },
): MethodFields {
  const empty: MethodFields = {
    holderName: null,
    iban: null,
    bic: null,
    phone: null,
    emailOrUrl: null,
    instructions: null,
  };
  switch (kind) {
    case "bank_account": {
      const fields: Record<string, string> = {};
      if (!input.holder_name) {
        fields.holder_name = "Indica el titular de la cuenta.";
      }
      if (!input.iban) {
        fields.iban = "Indica el IBAN de la cuenta.";
      }
      if (Object.keys(fields).length > 0) {
        throw new ApiError(
          "validation_error",
          400,
          "Completa los datos de la cuenta bancaria.",
          fields,
        );
      }
      const iban = validateIban(input.iban ?? "");
      if (!iban.valid) {
        throw new ApiError("iban_invalid", 400, IBAN_ERROR_MESSAGE, {
          iban: IBAN_ERROR_MESSAGE,
        });
      }
      if (input.bic && !isValidBic(input.bic)) {
        throw new ApiError(
          "validation_error",
          400,
          "El BIC debe tener 8 u 11 caracteres.",
          { bic: "El BIC debe tener 8 u 11 caracteres." },
        );
      }
      return {
        ...empty,
        holderName: input.holder_name,
        iban: iban.iban,
        bic: input.bic ? input.bic.toUpperCase() : null,
      };
    }
    case "bizum": {
      if (!input.phone || !PHONE_PATTERN.test(input.phone)) {
        throw new ApiError(
          "validation_error",
          400,
          "Indica el teléfono asociado a Bizum.",
          { phone: "Indica un teléfono válido." },
        );
      }
      return { ...empty, phone: input.phone.replace(/\s+/g, "") };
    }
    case "paypal": {
      const value = input.email_or_url ?? "";
      const isEmail = z.string().email().safeParse(value).success;
      const isUrl = /^https:\/\/\S+$/.test(value);
      if (!isEmail && !isUrl) {
        throw new ApiError(
          "validation_error",
          400,
          "Indica el email o el enlace de PayPal.",
          { email_or_url: "Indica un email o un enlace https válido." },
        );
      }
      return { ...empty, emailOrUrl: value };
    }
    case "other": {
      if (!input.instructions) {
        throw new ApiError(
          "validation_error",
          400,
          "Describe cómo debe pagarte el cliente.",
          { instructions: "Añade las instrucciones de pago." },
        );
      }
      return { ...empty, instructions: input.instructions };
    }
    case "cash":
      return empty;
  }
}

export async function listCollectionMethods(
  database: Database,
  companyId: string,
  archived?: boolean,
): Promise<CollectionMethodRow[]> {
  return database
    .select()
    .from(collectionMethods)
    .where(
      and(
        eq(collectionMethods.companyId, companyId),
        archived === true
          ? isNotNull(collectionMethods.archivedAt)
          : archived === false
            ? isNull(collectionMethods.archivedAt)
            : undefined,
      ),
    )
    .orderBy(asc(collectionMethods.createdAt));
}

async function loadMethod(
  database: Database,
  companyId: string,
  id: string,
): Promise<CollectionMethodRow> {
  const [method] = await database
    .select()
    .from(collectionMethods)
    .where(
      and(
        eq(collectionMethods.id, id),
        eq(collectionMethods.companyId, companyId),
      ),
    )
    .limit(1);
  if (!method) {
    throw new ResourceNotFoundError();
  }
  return method;
}

/** Clears the previous default before setting the new one (partial unique
 * index, checked per row), in one transaction. */
async function makeDefault(
  database: Database,
  companyId: string,
  id: string,
  now: Date,
): Promise<void> {
  const nowIso = now.toISOString();
  await runStatements(database, [
    sql`
      UPDATE ${collectionMethods} SET is_default = false, updated_at = ${nowIso}
      WHERE company_id = ${companyId} AND is_default AND id <> ${id}
    `,
    sql`
      UPDATE ${collectionMethods} SET is_default = true, updated_at = ${nowIso}
      WHERE company_id = ${companyId} AND id = ${id} AND archived_at IS NULL
    `,
  ]);
}

export async function createCollectionMethod(
  database: Database,
  companyId: string,
  input: CollectionMethodInput,
  now = new Date(),
): Promise<CollectionMethodRow> {
  const fields = validateMethodFields(input.kind, {
    holder_name: input.holder_name ?? null,
    iban: input.iban ?? null,
    bic: input.bic ?? null,
    phone: input.phone ?? null,
    email_or_url: input.email_or_url ?? null,
    instructions: input.instructions ?? null,
  });
  const active = await listCollectionMethods(database, companyId, false);
  const id = createUuidV7(now.getTime());
  await database.insert(collectionMethods).values({
    id,
    companyId,
    kind: input.kind,
    label: input.label,
    ...fields,
    createdAt: now,
    updatedAt: now,
  });
  // The first active method becomes the default automatically.
  if (input.is_default || active.length === 0) {
    await makeDefault(database, companyId, id, now);
  }
  return loadMethod(database, companyId, id);
}

export const collectionMethodPatchSchema = z
  .object({
    label: z.string().trim().min(1).max(60).optional(),
    holder_name: optionalText(120),
    iban: optionalText(42),
    bic: optionalText(11),
    phone: optionalText(20),
    email_or_url: optionalText(320),
    instructions: optionalText(300),
    is_default: z.literal(true).optional(),
    archived: z.boolean().optional(),
  })
  .strict();

export async function updateCollectionMethod(
  database: Database,
  companyId: string,
  id: string,
  rawInput: z.input<typeof collectionMethodPatchSchema>,
  now = new Date(),
): Promise<CollectionMethodRow> {
  const input = collectionMethodPatchSchema.parse(rawInput);
  const current = await loadMethod(database, companyId, id);
  const touchesFields = [
    "holder_name",
    "iban",
    "bic",
    "phone",
    "email_or_url",
    "instructions",
  ].some((key) => key in rawInput);
  const fields = touchesFields
    ? validateMethodFields(current.kind, {
        holder_name:
          "holder_name" in rawInput
            ? (input.holder_name ?? null)
            : current.holderName,
        iban: "iban" in rawInput ? (input.iban ?? null) : current.iban,
        bic: "bic" in rawInput ? (input.bic ?? null) : current.bic,
        phone: "phone" in rawInput ? (input.phone ?? null) : current.phone,
        email_or_url:
          "email_or_url" in rawInput
            ? (input.email_or_url ?? null)
            : current.emailOrUrl,
        instructions:
          "instructions" in rawInput
            ? (input.instructions ?? null)
            : current.instructions,
      })
    : {};
  if (input.archived === true && input.is_default) {
    throw new ApiError(
      "validation_error",
      400,
      "Un método archivado no puede ser el predeterminado.",
    );
  }

  await database
    .update(collectionMethods)
    .set({
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...fields,
      ...(input.archived !== undefined
        ? {
            archivedAt: input.archived ? now : null,
            // Archived methods are never the default (FR-021).
            ...(input.archived ? { isDefault: false } : {}),
          }
        : {}),
      updatedAt: now,
    })
    .where(
      and(
        eq(collectionMethods.id, id),
        eq(collectionMethods.companyId, companyId),
      ),
    );
  if (input.is_default) {
    const refreshed = await loadMethod(database, companyId, id);
    if (refreshed.archivedAt) {
      throw new ApiError(
        "conflict",
        409,
        "Restaura el método antes de marcarlo como predeterminado.",
      );
    }
    await makeDefault(database, companyId, id, now);
  }
  return loadMethod(database, companyId, id);
}

export function collectionMethodResponse(method: CollectionMethodRow) {
  return {
    id: method.id,
    kind: method.kind,
    label: method.label,
    holder_name: method.holderName,
    iban: method.iban,
    bic: method.bic,
    phone: method.phone,
    email_or_url: method.emailOrUrl,
    instructions: method.instructions,
    is_default: method.isDefault,
    archived_at: method.archivedAt,
  };
}

/** Snapshot frozen into an issued document (FR-022). */
export function collectionMethodSnapshot(method: CollectionMethodRow) {
  return Object.fromEntries(
    Object.entries({
      kind: method.kind,
      label: method.label,
      holder: method.holderName,
      iban: method.iban,
      bic: method.bic,
      phone: method.phone,
      email_or_url: method.emailOrUrl,
      instructions: method.instructions,
    }).filter(([, value]) => value !== null),
  );
}

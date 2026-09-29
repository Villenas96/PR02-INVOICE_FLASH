import type { z } from "zod";

import { ApiError } from "./errors";

export function validate<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
): z.output<TSchema> {
  const result = schema.safeParse(value);

  if (result.success) {
    return result.data;
  }

  const fields = Object.fromEntries(
    result.error.issues.map((issue) => [
      issue.path.join(".") || "body",
      issue.message,
    ]),
  );
  const message =
    result.error.issues[0]?.message ??
    "Revisa los datos indicados e inténtalo de nuevo.";

  throw new ApiError("validation_error", 400, message, fields);
}

export async function parseJson<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  try {
    return validate(schema, await request.json());
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(
      "validation_error",
      400,
      "El cuerpo de la solicitud no es JSON válido.",
    );
  }
}

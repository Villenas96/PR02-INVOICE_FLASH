/**
 * `database.execute(sql\`...\`)` returns a plain array under the
 * `postgres-js` driver (tests, CI) but `{ rows, rowCount, ... }` under the
 * `neon-http` driver (production). Normalize both shapes here instead of
 * assuming one of them.
 */
export function executionRows<TResult>(result: unknown): TResult[] {
  if (Array.isArray(result)) {
    return result as TResult[];
  }

  if (
    typeof result === "object" &&
    result !== null &&
    "rows" in result &&
    Array.isArray(result.rows)
  ) {
    return result.rows as TResult[];
  }

  return [];
}

export function firstExecutionRow<TResult>(
  result: unknown,
): TResult | undefined {
  return executionRows<TResult>(result)[0];
}

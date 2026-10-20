import type { SQL } from "drizzle-orm";

import type { Database } from "@/db";
import { executionRows } from "@/db/result";

/**
 * Runs raw statements atomically. Production uses neon-http, which has no
 * interactive transactions but runs `batch` in one transaction; tests and
 * scripts use postgres-js transactions. Returns each statement's rows.
 */
export async function runStatements(
  database: Database,
  statements: SQL[],
): Promise<unknown[][]> {
  if (statements.length === 0) {
    return [];
  }
  if ("batch" in database && typeof database.batch === "function") {
    const [first, ...rest] = statements.map((statement) =>
      database.execute(statement),
    );
    if (!first) {
      return [];
    }
    const results = await database.batch([first, ...rest]);
    return results.map((result) => executionRows<unknown>(result));
  }

  const transactional = database as unknown as {
    transaction<T>(
      callback: (transaction: {
        execute(query: SQL): PromiseLike<unknown>;
      }) => Promise<T>,
    ): Promise<T>;
  };
  return transactional.transaction(async (transaction) => {
    const results: unknown[][] = [];
    for (const statement of statements) {
      results.push(
        executionRows<unknown>(await transaction.execute(statement)),
      );
    }
    return results;
  });
}

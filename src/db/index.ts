import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

export function createDatabase(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL debe estar configurada para acceder a la base de datos.",
    );
  }

  const fetchEndpoint = process.env.NEON_HTTP_ENDPOINT;
  if (fetchEndpoint) {
    neonConfig.fetchEndpoint = fetchEndpoint;
  }

  return drizzle({
    client: neon(databaseUrl),
    schema,
  });
}

export type Database = ReturnType<typeof createDatabase>;

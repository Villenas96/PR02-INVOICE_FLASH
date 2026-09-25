import { createServer } from "node:http";

import postgres from "postgres";

const port = Number.parseInt(process.env.NEON_HTTP_PROXY_PORT ?? "55433", 10);
const databaseUrl = process.env.E2E_DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "E2E_DATABASE_URL es obligatoria para el proxy HTTP de Neon.",
  );
}

if (process.env.DATABASE_URL === databaseUrl) {
  throw new Error(
    "La base E2E debe ser distinta de la configurada como DATABASE_URL.",
  );
}

const rawParameter = (type) => ({
  serialize: (value) => String(value),
  to: type,
});
const database = postgres(databaseUrl, {
  max: 4,
  types: {
    rawBoolean: rawParameter(16),
    rawBytea: rawParameter(17),
    rawDate: rawParameter(1082),
    rawJson: rawParameter(114),
    rawJsonb: rawParameter(3802),
    rawTimestamp: rawParameter(1114),
    rawTimestampWithTimezone: rawParameter(1184),
  },
});

const DATE_ONLY_TYPE_OID = 1082;

function rawValue(value, typeOid) {
  if (value === null) {
    return null;
  }
  if (value instanceof Uint8Array) {
    return `\\x${Buffer.from(value).toString("hex")}`;
  }
  if (value instanceof Date) {
    // postgres.js parses both `date` and `timestamp*` columns into JS Date
    // objects. A plain `date` column must round-trip as `YYYY-MM-DD`, not a
    // full ISO timestamp, or downstream `date`-mode parsing rejects it.
    return typeOid === DATE_ONLY_TYPE_OID
      ? value.toISOString().slice(0, 10)
      : value.toISOString();
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") {
    return value ? "t" : "f";
  }
  return String(value);
}

function neonResult(result) {
  const columns = result.columns ?? [];
  return {
    command: result.command,
    fields: columns.map((column) => ({
      dataTypeID: column.type,
      name: column.name,
    })),
    rowCount: result.count,
    // Rows come from `.values()` (array mode): positional, so two columns
    // sharing a name (e.g. two joined tables both having an `id` column)
    // don't collapse into one property the way plain object-mode rows would.
    rows: result.map((row) =>
      row.map((value, index) => rawValue(value, columns[index]?.type)),
    ),
  };
}

async function executeQuery(sql, query) {
  const result = await sql.unsafe(query.query, query.params ?? []).values();
  if (process.env.DEBUG_NEON_HTTP_PROXY === "1") {
    console.log(
      JSON.stringify({
        command: result.command,
        booleanParameter: query.query.includes("email_verified")
          ? query.params?.[0]
          : undefined,
        query: query.query,
        rowCount: result.count,
      }),
    );
  }
  return neonResult(result);
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(204).end();
    return;
  }

  if (request.method !== "POST" || request.url !== "/sql") {
    response.writeHead(404).end();
    return;
  }

  try {
    const body = await requestBody(request);
    const payload = Array.isArray(body.queries)
      ? await database.begin(async (transaction) => {
          const results = [];
          for (const query of body.queries) {
            results.push(await executeQuery(transaction, query));
          }
          return { results };
        })
      : await executeQuery(database, body);

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
  } catch (error) {
    if (process.env.DEBUG_NEON_HTTP_PROXY === "1") {
      console.error(
        JSON.stringify({
          code: error && typeof error === "object" ? error.code : undefined,
          message: error instanceof Error ? error.message : "Query failed",
        }),
      );
    }
    response.writeHead(400, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        code: error && typeof error === "object" ? error.code : undefined,
        message: error instanceof Error ? error.message : "Query failed",
      }),
    );
  }
});

server.listen(port, "127.0.0.1");

async function shutdown() {
  server.close();
  await database.end({ timeout: 5 });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

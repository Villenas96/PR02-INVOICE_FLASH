import { and, desc, eq, sql } from "drizzle-orm";

import { createDatabase, type Database } from "@/db";
import { aiConnections } from "@/db/schema/ai-connection";
import { companies } from "@/db/schema/company";
import {
  oauthAccessTokens,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
} from "@/db/schema/oauth";
import { ApiError } from "@/lib/api/errors";
import { createUuidV7 } from "@/lib/ids";
import { hasFeature, type Plan } from "@/lib/plan";
import { type CompanyContext, ResourceNotFoundError } from "@/services/context";
import { requireFeature } from "@/services/entitlements";

/** `last_used_at` is refreshed at most this often (one write per minute). */
const LAST_USED_GRANULARITY_SECONDS = 60;

export type AiConnectionRow = typeof aiConnections.$inferSelect;

export function aiConnectionResponse(connection: AiConnectionRow) {
  return {
    id: connection.id,
    client_name: connection.clientName,
    status: connection.status,
    authorized_at: connection.authorizedAt,
    last_used_at: connection.lastUsedAt,
    revoked_at: connection.revokedAt,
  };
}

/**
 * The owner authorises an assistant for their company (FR-054). Requires
 * Pro; the OAuth client must exist (registered by the assistant itself).
 */
export async function createAiConnection(input: {
  context: CompanyContext;
  oauthClientId: string;
  database?: Database;
  now?: Date;
}): Promise<AiConnectionRow> {
  const database = input.database ?? createDatabase();
  const now = input.now ?? new Date();
  if (input.context.role !== "owner") {
    throw new ApiError(
      "read_only_access",
      403,
      "Solo la persona titular puede conectar un asistente.",
    );
  }
  requireFeature(input.context, "ai_assistant");
  const [client] = await database
    .select({
      name: oauthClients.name,
      disabled: oauthClients.disabled,
    })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, input.oauthClientId))
    .limit(1);
  if (!client || client.disabled) {
    throw new ResourceNotFoundError();
  }
  const [created] = await database
    .insert(aiConnections)
    .values({
      id: createUuidV7(now.getTime()),
      userId: input.context.userId,
      companyId: input.context.companyId,
      oauthClientId: input.oauthClientId,
      clientName: client.name?.trim() || "Asistente de IA",
      authorizedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (created) {
    return created;
  }
  // Already connected: idempotent.
  const [existing] = await database
    .select()
    .from(aiConnections)
    .where(
      and(
        eq(aiConnections.userId, input.context.userId),
        eq(aiConnections.oauthClientId, input.oauthClientId),
        eq(aiConnections.status, "active"),
      ),
    )
    .limit(1);
  if (!existing) {
    throw new ResourceNotFoundError();
  }
  return existing;
}

export async function listAiConnections(
  companyId: string,
  database: Database = createDatabase(),
): Promise<AiConnectionRow[]> {
  return database
    .select()
    .from(aiConnections)
    .where(eq(aiConnections.companyId, companyId))
    .orderBy(desc(aiConnections.authorizedAt), desc(aiConnections.id))
    .limit(100);
}

/**
 * Revokes a connection at once: the MCP endpoint checks `status` on every
 * request, and the OAuth consent and tokens go too, so the assistant must
 * ask for explicit consent again to reconnect.
 */
export async function revokeAiConnection(input: {
  context: CompanyContext;
  connectionId: string;
  database?: Database;
  now?: Date;
}): Promise<AiConnectionRow> {
  const database = input.database ?? createDatabase();
  const now = input.now ?? new Date();
  const [connection] = await database
    .select()
    .from(aiConnections)
    .where(
      and(
        eq(aiConnections.id, input.connectionId),
        eq(aiConnections.companyId, input.context.companyId),
      ),
    )
    .limit(1);
  if (!connection) {
    throw new ResourceNotFoundError();
  }
  if (connection.status === "revoked") {
    return connection;
  }
  const [revoked] = await database
    .update(aiConnections)
    .set({ status: "revoked", revokedAt: now })
    .where(
      and(
        eq(aiConnections.id, connection.id),
        eq(aiConnections.status, "active"),
      ),
    )
    .returning();
  await database
    .delete(oauthAccessTokens)
    .where(
      and(
        eq(oauthAccessTokens.clientId, connection.oauthClientId),
        eq(oauthAccessTokens.userId, connection.userId),
      ),
    );
  await database
    .delete(oauthRefreshTokens)
    .where(
      and(
        eq(oauthRefreshTokens.clientId, connection.oauthClientId),
        eq(oauthRefreshTokens.userId, connection.userId),
      ),
    );
  await database
    .delete(oauthConsents)
    .where(
      and(
        eq(oauthConsents.clientId, connection.oauthClientId),
        eq(oauthConsents.userId, connection.userId),
      ),
    );
  return revoked ?? connection;
}

export interface McpPrincipal {
  connectionId: string;
  userId: string;
  companyId: string;
  clientName: string;
  plan: Plan;
}

export class McpAccessError extends Error {
  constructor(
    public readonly reason: "unknown_connection" | "plan_not_available",
  ) {
    super(
      reason === "plan_not_available"
        ? "La conexión con asistentes de IA requiere el plan Pro."
        : "La conexión con el asistente no está activa.",
    );
    this.name = "McpAccessError";
  }
}

/**
 * Resolves the principal behind a verified access token. Runs on every MCP
 * request with no caching: a revoked connection or a company that dropped
 * from Pro is rejected immediately (FR-054).
 */
export async function resolveMcpPrincipal(input: {
  userId: string;
  oauthClientId: string;
  database?: Database;
  now?: Date;
}): Promise<McpPrincipal> {
  const database = input.database ?? createDatabase();
  const now = input.now ?? new Date();
  const [row] = await database
    .select({
      id: aiConnections.id,
      userId: aiConnections.userId,
      companyId: aiConnections.companyId,
      clientName: aiConnections.clientName,
      plan: companies.plan,
    })
    .from(aiConnections)
    .innerJoin(companies, eq(companies.id, aiConnections.companyId))
    .where(
      and(
        eq(aiConnections.userId, input.userId),
        eq(aiConnections.oauthClientId, input.oauthClientId),
        eq(aiConnections.status, "active"),
      ),
    )
    .limit(1);
  if (!row) {
    throw new McpAccessError("unknown_connection");
  }
  const plan = row.plan;
  if (!hasFeature(plan, "ai_assistant")) {
    throw new McpAccessError("plan_not_available");
  }
  await database
    .update(aiConnections)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(aiConnections.id, row.id),
        sql`(${aiConnections.lastUsedAt} IS NULL OR ${aiConnections.lastUsedAt} < ${now.toISOString()}::timestamptz - make_interval(secs => ${LAST_USED_GRANULARITY_SECONDS}))`,
      ),
    );
  return {
    connectionId: row.id,
    userId: row.userId,
    companyId: row.companyId,
    clientName: row.clientName,
    plan,
  };
}

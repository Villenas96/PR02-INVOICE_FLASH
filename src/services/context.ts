import { eq } from "drizzle-orm";

import { createDatabase, type Database } from "@/db";
import { companies } from "@/db/schema";
import {
  ApiError,
  AuthenticationRequiredError,
  ResourceNotFoundError,
} from "@/lib/api/errors";
import { auth } from "@/lib/auth";
import { createUuidV7 } from "@/lib/ids";
import type { Plan } from "@/lib/plan";
import {
  type CompanyRole,
  recordAdvisorSession,
  resolveActiveCompany,
} from "@/services/active-company";
import { mcpPrincipalOf } from "@/services/mcp/principal";

export { AuthenticationRequiredError, ResourceNotFoundError };

export type AccessLevel = "read" | "write";
export type { CompanyRole };

export interface CompanyContext {
  userId: string;
  companyId: string;
  role: CompanyRole;
  /** Effective plan of the active company, read on every request. */
  plan: Plan;
  /** Set when an AI assistant acts for the owner (FR-056): audit actor. */
  actingAs?: string;
}

/** Who document events are attributed to: the assistant, or the user. */
export function auditActor(context: CompanyContext): string {
  return context.actingAs ?? context.userId;
}

export interface ResolveCompanyContextOptions {
  /** Every route declares whether it only reads or also writes (FR-051). */
  access: AccessLevel;
  database?: Database;
  now?: Date;
}

export function readOnlyAccessError(): ApiError {
  return new ApiError(
    "read_only_access",
    403,
    "Tu acceso a esta empresa es de solo lectura.",
  );
}

export function advisorAccessSuspendedError(): ApiError {
  return new ApiError(
    "advisor_access_suspended",
    403,
    "El acceso de la gestoría está en pausa: esta empresa no tiene el plan Pro.",
  );
}

export interface SessionIdentity {
  userId: string;
  sessionId: string;
  email: string;
}

/** Session-only routes (accept an invitation, switch company). */
export async function requireSession(
  request: Request,
): Promise<SessionIdentity> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    throw new AuthenticationRequiredError();
  }
  return {
    userId: session.user.id,
    sessionId: session.session.id,
    email: session.user.email,
  };
}

/**
 * Resolves the session's active company for every API request (FR-050–053).
 * Each route states its access level so read-only roles are denied
 * centrally: an advisor gets `read_only_access` on any `write` route and
 * `advisor_access_suspended` while the company is not Pro. Records outside
 * the resolved company stay invisible (404) through `company_id` scoping in
 * each query.
 */
export async function resolveCompanyContext(
  request: Request,
  options: ResolveCompanyContextOptions,
): Promise<CompanyContext> {
  const assistant = mcpPrincipalOf(request);
  if (assistant) {
    // Already authenticated and authorised by the MCP endpoint (Bearer token,
    // active connection, Pro): act as the owner of the connected company.
    return {
      userId: assistant.userId,
      companyId: assistant.companyId,
      role: "owner",
      plan: assistant.plan,
      actingAs: assistant.actingAs,
    };
  }
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    throw new AuthenticationRequiredError();
  }

  const userId = session.user.id;
  const db = options.database ?? createDatabase();
  const active = await resolveActiveCompany(db, {
    userId,
    sessionId: session.session.id,
  });

  if (active?.role === "advisor") {
    if (active.suspended) {
      throw advisorAccessSuspendedError();
    }
    if (options.access === "write") {
      throw readOnlyAccessError();
    }
    const now = options.now ?? new Date();
    await recordAdvisorSession(db, {
      companyId: active.companyId,
      userId,
      id: createUuidV7(now.getTime()),
      now,
    });
    return {
      userId,
      companyId: active.companyId,
      role: "advisor",
      plan: active.plan,
    };
  }
  if (active) {
    return {
      userId,
      companyId: active.companyId,
      role: "owner",
      plan: active.plan,
    };
  }

  const ownCompany = { id: companies.id, plan: companies.plan };
  const [createdCompany] = await db
    .insert(companies)
    .values({
      id: createUuidV7(),
      userId,
      email: session.user.email,
    })
    .onConflictDoNothing({ target: companies.userId })
    .returning(ownCompany);

  if (createdCompany) {
    return ownerContext(userId, createdCompany);
  }

  const [concurrentlyCreatedCompany] = await db
    .select(ownCompany)
    .from(companies)
    .where(eq(companies.userId, userId));

  if (!concurrentlyCreatedCompany) {
    throw new ResourceNotFoundError();
  }

  return ownerContext(userId, concurrentlyCreatedCompany);
}

function ownerContext(
  userId: string,
  company: { id: string; plan: Plan },
): CompanyContext {
  return {
    userId,
    companyId: company.id,
    role: "owner",
    plan: company.plan,
  };
}

/**
 * Resolves a company-scoped record. Callers must include `company_id` in their
 * query; a missing result intentionally becomes a generic 404 for all users.
 */
export async function resolveCompanyResource<T>(
  context: CompanyContext,
  load: (companyId: string) => Promise<T | undefined>,
): Promise<T> {
  const resource = await load(context.companyId);

  if (!resource) {
    throw new ResourceNotFoundError();
  }

  return resource;
}

/** Owner-only operations (subscription, advisor management, …). */
export function requireOwner(context: CompanyContext): void {
  if (context.role !== "owner") {
    throw readOnlyAccessError();
  }
}

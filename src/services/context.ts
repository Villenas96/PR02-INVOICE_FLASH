import { eq } from "drizzle-orm";

import { createDatabase } from "@/db";
import { companies } from "@/db/schema";
import {
  ApiError,
  AuthenticationRequiredError,
  ResourceNotFoundError,
} from "@/lib/api/errors";
import { auth } from "@/lib/auth";
import { createUuidV7 } from "@/lib/ids";
import { normalizePlan, type Plan } from "@/lib/plan";

export { AuthenticationRequiredError, ResourceNotFoundError };

export type AccessLevel = "read" | "write";
export type CompanyRole = "owner" | "advisor";

export interface CompanyContext {
  userId: string;
  companyId: string;
  role: CompanyRole;
  /** Effective plan of the active company, read on every request. */
  plan: Plan;
}

export interface ResolveCompanyContextOptions {
  /** Every route declares whether it only reads or also writes (FR-051). */
  access: AccessLevel;
}

/**
 * Resolves the session's company for every API request. Each route must state
 * its access level so that read-only roles can be denied centrally. Records
 * outside the resolved company stay invisible (404) through `company_id`
 * scoping in each query.
 */
export async function resolveCompanyContext(
  request: Request,
  _options: ResolveCompanyContextOptions,
): Promise<CompanyContext> {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    throw new AuthenticationRequiredError();
  }

  const userId = session.user.id;
  const db = createDatabase();
  const ownCompany = { id: companies.id, plan: companies.plan };
  const [existingCompany] = await db
    .select(ownCompany)
    .from(companies)
    .where(eq(companies.userId, userId));

  if (existingCompany) {
    return ownerContext(userId, existingCompany);
  }

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
  company: { id: string; plan: Parameters<typeof normalizePlan>[0] },
): CompanyContext {
  return {
    userId,
    companyId: company.id,
    role: "owner",
    plan: normalizePlan(company.plan),
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
    throw new ApiError(
      "read_only_access",
      403,
      "Tu acceso a esta empresa es de solo lectura.",
    );
  }
}

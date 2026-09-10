import { eq } from "drizzle-orm";

import { createDatabase } from "@/db";
import { companies } from "@/db/schema";
import { auth } from "@/lib/auth";
import { createUuidV7 } from "@/lib/ids";

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Necesitas iniciar sesión para continuar.");
  }
}

export class ResourceNotFoundError extends Error {
  constructor() {
    super("No se ha encontrado el recurso solicitado.");
  }
}

export interface CompanyContext {
  userId: string;
  companyId: string;
}

export async function resolveCompanyContext(
  request: Request,
): Promise<CompanyContext> {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    throw new AuthenticationRequiredError();
  }

  const db = createDatabase();
  const [existingCompany] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.userId, session.user.id));

  if (existingCompany) {
    return { userId: session.user.id, companyId: existingCompany.id };
  }

  const [createdCompany] = await db
    .insert(companies)
    .values({
      id: createUuidV7(),
      userId: session.user.id,
      email: session.user.email,
    })
    .onConflictDoNothing({ target: companies.userId })
    .returning({ id: companies.id });

  if (createdCompany) {
    return { userId: session.user.id, companyId: createdCompany.id };
  }

  const [concurrentlyCreatedCompany] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.userId, session.user.id));

  if (!concurrentlyCreatedCompany) {
    throw new ResourceNotFoundError();
  }

  return { userId: session.user.id, companyId: concurrentlyCreatedCompany.id };
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

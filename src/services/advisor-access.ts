import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { createDatabase, type Database } from "@/db";
import { accessEvents } from "@/db/schema/access-event";
import { sessions, users } from "@/db/schema/auth";
import { companies } from "@/db/schema/company";
import { companyAccess } from "@/db/schema/company-access";
import { emailDeliveries } from "@/db/schema/email-delivery";
import { ApiError } from "@/lib/api/errors";
import { decodeIdCursor, encodeIdCursor } from "@/lib/api/pagination";
import {
  advisorInviteSeed,
  DOWNLOAD_TOKEN_TTL_MS,
  deriveSignedToken,
  hashDownloadToken,
  isSignedDownloadToken,
} from "@/lib/download-tokens";
import { createUuidV7 } from "@/lib/ids";
import { normalizePlan } from "@/lib/plan";
import {
  type CompanyContext,
  ResourceNotFoundError,
  requireOwner,
} from "@/services/context";
import type { EmailQueue } from "@/services/email/auth-deliveries";
import { enqueueEmail } from "@/services/email/notices";
import { requireFeature } from "@/services/entitlements";

/** Invitations expire after 7 days (FR-050). */
export const INVITE_TTL_MS = DOWNLOAD_TOKEN_TTL_MS;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function emailHash(email: string): Promise<string> {
  return hashDownloadToken(normalizeEmail(email));
}

function inviteIdempotencyKey(accessId: string): string {
  return `advisor_invite:${accessId}`;
}

function invalidInvitation(): ApiError {
  return new ApiError(
    "conflict",
    409,
    "La invitación no es válida o ha caducado. Pide una nueva a tu cliente.",
  );
}

// ------------------------------------------------------------ owner side ---

export async function inviteAdvisor(input: {
  database?: Database;
  emailQueue: EmailQueue;
  context: CompanyContext;
  email: string;
  secret: string;
  now?: Date;
}): Promise<{ id: string; expiresAt: Date }> {
  requireOwner(input.context);
  requireFeature(input.context, "advisor_access");
  const database = input.database ?? createDatabase();
  const now = input.now ?? new Date();
  const email = normalizeEmail(input.email);

  const [company] = await database
    .select({ legalName: companies.legalName, ownerEmail: users.email })
    .from(companies)
    .innerJoin(users, eq(users.id, companies.userId))
    .where(eq(companies.id, input.context.companyId));
  if (!company) {
    throw new ResourceNotFoundError();
  }
  if (normalizeEmail(company.ownerEmail) === email) {
    throw new ApiError(
      "validation_error",
      400,
      "Invita el email de tu gestoría, no el tuyo.",
      { email: "Usa el email de tu gestoría." },
    );
  }

  const id = createUuidV7(now.getTime());
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  const { hash } = await deriveSignedToken(input.secret, advisorInviteSeed(id));
  await database.insert(companyAccess).values({
    id,
    companyId: input.context.companyId,
    role: "advisor",
    status: "pending",
    invitedEmailHash: await emailHash(email),
    inviteTokenHash: hash,
    inviteExpiresAt: expiresAt,
    createdAt: now,
    updatedAt: now,
  });
  await enqueueEmail({
    database,
    queue: input.emailQueue,
    purpose: "advisor_invite",
    template: "advisor_invite",
    companyId: input.context.companyId,
    recipientEmail: email,
    idempotencyKey: inviteIdempotencyKey(id),
    payload: {
      access_id: id,
      company_name: company.legalName ?? "Tu cliente",
      expires_at: expiresAt.toISOString(),
    },
    now,
  });
  return { id, expiresAt };
}

export interface AdvisorAccessView {
  id: string;
  status: "pending" | "active" | "revoked" | "expired";
  /** Account email once accepted; invited email while pending (≤ 30 days). */
  email: string | null;
  invitedAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
  lastAccessAt: Date | null;
}

export async function listAdvisorAccess(input: {
  database?: Database;
  context: CompanyContext;
  now?: Date;
}): Promise<AdvisorAccessView[]> {
  requireOwner(input.context);
  const database = input.database ?? createDatabase();
  const now = input.now ?? new Date();
  const rows = await database
    .select({
      id: companyAccess.id,
      status: companyAccess.status,
      accountEmail: users.email,
      invitedEmail: emailDeliveries.recipientEmail,
      invitedAt: companyAccess.createdAt,
      acceptedAt: companyAccess.acceptedAt,
      revokedAt: companyAccess.revokedAt,
      expiresAt: companyAccess.inviteExpiresAt,
      lastAccessAt: sql<Date | null>`(
        SELECT max(${accessEvents.createdAt}) FROM ${accessEvents}
        WHERE ${accessEvents.companyId} = ${companyAccess.companyId}
          AND ${accessEvents.actorUserId} = ${companyAccess.userId}
      )`.mapWith((value) => (value ? new Date(value) : null)),
    })
    .from(companyAccess)
    .leftJoin(users, eq(users.id, companyAccess.userId))
    .leftJoin(
      emailDeliveries,
      eq(
        emailDeliveries.idempotencyKey,
        sql`'advisor_invite:' || ${companyAccess.id}::text`,
      ),
    )
    .where(eq(companyAccess.companyId, input.context.companyId))
    .orderBy(desc(companyAccess.createdAt));
  return rows.map((row) => ({
    id: row.id,
    status:
      row.status === "pending" && row.expiresAt <= now ? "expired" : row.status,
    email: row.accountEmail ?? row.invitedEmail ?? null,
    invitedAt: row.invitedAt,
    acceptedAt: row.acceptedAt,
    revokedAt: row.revokedAt,
    expiresAt: row.expiresAt,
    lastAccessAt: row.lastAccessAt,
  }));
}

export async function listAccessEvents(input: {
  database?: Database;
  context: CompanyContext;
  limit: number;
  cursor?: string;
}) {
  requireOwner(input.context);
  const database = input.database ?? createDatabase();
  const afterId = decodeIdCursor(input.cursor);
  const rows = await database
    .select({
      id: accessEvents.id,
      action: accessEvents.action,
      actorEmail: users.email,
      targetId: accessEvents.targetId,
      createdAt: accessEvents.createdAt,
    })
    .from(accessEvents)
    .innerJoin(users, eq(users.id, accessEvents.actorUserId))
    .where(
      and(
        eq(accessEvents.companyId, input.context.companyId),
        afterId ? lt(accessEvents.id, afterId) : undefined,
      ),
    )
    .orderBy(desc(accessEvents.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    items: page,
    nextCursor:
      rows.length > input.limit && last ? encodeIdCursor(last.id) : null,
  };
}

/** Immediate effect: the advisor's next request no longer resolves it. */
export async function revokeAdvisorAccess(input: {
  database?: Database;
  context: CompanyContext;
  accessId: string;
  now?: Date;
}): Promise<void> {
  requireOwner(input.context);
  const database = input.database ?? createDatabase();
  const now = input.now ?? new Date();
  const [revoked] = await database
    .update(companyAccess)
    .set({ status: "revoked", revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(companyAccess.id, input.accessId),
        eq(companyAccess.companyId, input.context.companyId),
        sql`${companyAccess.status} <> 'revoked'`,
      ),
    )
    .returning({ id: companyAccess.id, userId: companyAccess.userId });
  if (!revoked) {
    const [exists] = await database
      .select({ id: companyAccess.id })
      .from(companyAccess)
      .where(
        and(
          eq(companyAccess.id, input.accessId),
          eq(companyAccess.companyId, input.context.companyId),
        ),
      );
    if (!exists) {
      throw new ResourceNotFoundError();
    }
    return;
  }
  await database.insert(accessEvents).values({
    id: createUuidV7(now.getTime()),
    companyId: input.context.companyId,
    actorUserId: input.context.userId,
    action: "access_revoked",
    targetId: revoked.id,
    createdAt: now,
  });
}

// ---------------------------------------------------------- advisor side ---

/**
 * Links the signed-in account to the inviting company. The invitation is
 * personal: the account email must be the invited one.
 */
export async function acceptInvitation(input: {
  database?: Database;
  token: string;
  secret: string;
  userId: string;
  userEmail: string;
  sessionId: string;
  now?: Date;
}): Promise<{ companyId: string }> {
  const database = input.database ?? createDatabase();
  const now = input.now ?? new Date();
  if (!(await isSignedDownloadToken(input.secret, input.token))) {
    throw invalidInvitation();
  }
  const [access] = await database
    .select({
      id: companyAccess.id,
      companyId: companyAccess.companyId,
      status: companyAccess.status,
      userId: companyAccess.userId,
      invitedEmailHash: companyAccess.invitedEmailHash,
      expiresAt: companyAccess.inviteExpiresAt,
      ownerId: companies.userId,
    })
    .from(companyAccess)
    .innerJoin(companies, eq(companies.id, companyAccess.companyId))
    .where(
      eq(companyAccess.inviteTokenHash, await hashDownloadToken(input.token)),
    );
  if (!access) {
    throw invalidInvitation();
  }
  if (access.status === "active" && access.userId === input.userId) {
    await setActiveCompany({ ...input, companyId: access.companyId });
    return { companyId: access.companyId };
  }
  if (access.status !== "pending" || access.expiresAt <= now) {
    throw invalidInvitation();
  }
  if (access.invitedEmailHash !== (await emailHash(input.userEmail))) {
    throw new ApiError(
      "conflict",
      409,
      "Esta invitación es para otra dirección de correo. Entra con la cuenta del email invitado.",
    );
  }
  if (access.ownerId === input.userId) {
    throw invalidInvitation();
  }

  const [accepted] = await database
    .update(companyAccess)
    .set({
      status: "active",
      userId: input.userId,
      acceptedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(companyAccess.id, access.id),
        eq(companyAccess.status, "pending"),
        gt(companyAccess.inviteExpiresAt, now),
      ),
    )
    .returning({ id: companyAccess.id })
    .catch((error: unknown) => {
      // Already an active advisor of this company through another invite.
      if (String(error).includes("company_access_company_user_active_unique")) {
        return [];
      }
      throw error;
    });
  if (!accepted) {
    const [existing] = await database
      .select({ id: companyAccess.id })
      .from(companyAccess)
      .where(
        and(
          eq(companyAccess.companyId, access.companyId),
          eq(companyAccess.userId, input.userId),
          eq(companyAccess.status, "active"),
        ),
      );
    if (!existing) {
      throw invalidInvitation();
    }
  }
  await setActiveCompany({ ...input, companyId: access.companyId });
  return { companyId: access.companyId };
}

export interface AccessibleCompany {
  companyId: string;
  legalName: string | null;
  role: "owner" | "advisor";
  suspended: boolean;
}

export async function listMyCompanies(input: {
  database?: Database;
  userId: string;
}): Promise<AccessibleCompany[]> {
  const database = input.database ?? createDatabase();
  const advised = alias(companies, "advised_company");
  const [own, accesses] = await Promise.all([
    database
      .select({ id: companies.id, legalName: companies.legalName })
      .from(companies)
      .where(eq(companies.userId, input.userId)),
    database
      .select({
        id: advised.id,
        legalName: advised.legalName,
        plan: advised.plan,
      })
      .from(companyAccess)
      .innerJoin(advised, eq(advised.id, companyAccess.companyId))
      .where(
        and(
          eq(companyAccess.userId, input.userId),
          eq(companyAccess.status, "active"),
        ),
      )
      .orderBy(advised.legalName),
  ]);
  return [
    ...own.map((company) => ({
      companyId: company.id,
      legalName: company.legalName,
      role: "owner" as const,
      suspended: false,
    })),
    ...accesses.map((company) => ({
      companyId: company.id,
      legalName: company.legalName,
      role: "advisor" as const,
      suspended: normalizePlan(company.plan) !== "pro",
    })),
  ];
}

/** FR-052: only an own company or one with an active access. */
export async function setActiveCompany(input: {
  database?: Database;
  userId: string;
  sessionId: string;
  companyId: string;
}): Promise<void> {
  const database = input.database ?? createDatabase();
  const accessible = await listMyCompanies(input);
  if (!accessible.some((company) => company.companyId === input.companyId)) {
    throw new ResourceNotFoundError();
  }
  await database
    .update(sessions)
    .set({ activeCompanyId: input.companyId })
    .where(
      and(eq(sessions.id, input.sessionId), eq(sessions.userId, input.userId)),
    );
}

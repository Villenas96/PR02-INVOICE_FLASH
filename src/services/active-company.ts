import { sql } from "drizzle-orm";

import type { Database } from "@/db";
import { firstExecutionRow } from "@/db/result";
import { normalizePlan, type Plan } from "@/lib/plan";

export type CompanyRole = "owner" | "advisor";

export interface ActiveCompany {
  companyId: string;
  role: CompanyRole;
  plan: Plan;
  /** Advisor on a company without Pro: access is paused, never deleted. */
  suspended: boolean;
}

interface SessionRow extends Record<string, unknown> {
  active_company_id: string | null;
  own_id: string | null;
  own_plan: string | null;
  target_id: string | null;
  target_plan: string | null;
  access_active: boolean | null;
  first_access_company_id: string | null;
  first_access_plan: string | null;
}

/**
 * The company a session acts on (FR-052): `session.active_company_id` when it
 * is the user's own company or one with an active advisor access; otherwise
 * the own company. An advisor-only account without a selection lands on its
 * first accessible company. A revoked or unknown selection is cleared, so
 * revocation takes effect on the very next request.
 *
 * Returns `null` when the user has neither an own company nor any access
 * (the caller creates the own company, as in v1).
 */
export async function resolveActiveCompany(
  database: Database,
  session: { userId: string; sessionId: string },
): Promise<ActiveCompany | null> {
  const result = await database.execute<SessionRow>(sql`
    SELECT
      s.active_company_id,
      own.id AS own_id,
      own.plan::text AS own_plan,
      target.id AS target_id,
      target.plan::text AS target_plan,
      (access.id IS NOT NULL) AS access_active,
      first_access.company_id AS first_access_company_id,
      first_access.plan AS first_access_plan
    FROM (SELECT ${session.userId}::uuid AS user_id) AS me
    LEFT JOIN session s
      ON s.id = ${session.sessionId}::uuid AND s.user_id = me.user_id
    LEFT JOIN company own ON own.user_id = me.user_id
    LEFT JOIN company target ON target.id = s.active_company_id
    LEFT JOIN company_access access
      ON access.company_id = s.active_company_id
      AND access.user_id = me.user_id
      AND access.status = 'active'
    LEFT JOIN LATERAL (
      SELECT ca.company_id, c.plan::text AS plan
      FROM company_access ca
      JOIN company c ON c.id = ca.company_id
      WHERE ca.user_id = me.user_id AND ca.status = 'active'
      ORDER BY ca.accepted_at, ca.company_id
      LIMIT 1
    ) first_access ON TRUE
  `);
  const row = firstExecutionRow<SessionRow>(result);
  if (!row) {
    return null;
  }

  const selected = row.active_company_id;
  if (selected && selected === row.own_id && row.own_plan) {
    return owner(row.own_id, row.own_plan);
  }
  if (selected && row.target_id && row.access_active && row.target_plan) {
    return advisor(row.target_id, row.target_plan);
  }
  if (selected) {
    // Revoked, expired or foreign: forget it so the next request is clean.
    await database.execute(sql`
      UPDATE session SET active_company_id = NULL
      WHERE id = ${session.sessionId}::uuid AND user_id = ${session.userId}::uuid
    `);
  }
  if (row.own_id && row.own_plan) {
    return owner(row.own_id, row.own_plan);
  }
  if (row.first_access_company_id && row.first_access_plan) {
    await database.execute(sql`
      UPDATE session SET active_company_id = ${row.first_access_company_id}::uuid
      WHERE id = ${session.sessionId}::uuid AND user_id = ${session.userId}::uuid
    `);
    return advisor(row.first_access_company_id, row.first_access_plan);
  }
  return null;
}

function owner(companyId: string, plan: string): ActiveCompany {
  return {
    companyId,
    role: "owner",
    plan: normalizePlan(plan as Parameters<typeof normalizePlan>[0]),
    suspended: false,
  };
}

function advisor(companyId: string, rawPlan: string): ActiveCompany {
  const plan = normalizePlan(rawPlan as Parameters<typeof normalizePlan>[0]);
  return { companyId, role: "advisor", plan, suspended: plan !== "pro" };
}

/**
 * `session_started` at most once per advisor, company and Madrid day: the
 * partial unique index turns repeats into no-ops (FR-053).
 */
export async function recordAdvisorSession(
  database: Database,
  input: { companyId: string; userId: string; id: string; now: Date },
): Promise<void> {
  await database.execute(sql`
    INSERT INTO access_event (id, company_id, actor_user_id, action, created_at)
    VALUES (${input.id}::uuid, ${input.companyId}::uuid, ${input.userId}::uuid,
      'session_started', ${input.now.toISOString()}::timestamptz)
    ON CONFLICT DO NOTHING
  `);
}

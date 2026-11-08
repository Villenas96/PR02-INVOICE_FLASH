import { and, eq, isNull, sql } from "drizzle-orm";

import { createDatabase, type Database } from "@/db";
import { aiConfirmations } from "@/db/schema/ai-confirmation";
import { documents } from "@/db/schema/document";
import { ApiError } from "@/lib/api/errors";
import { createUuidV7 } from "@/lib/ids";
import type { McpPrincipal } from "@/services/mcp/connections";

/** A confirmation token lives five minutes and works once (FR-056). */
export const CONFIRMATION_TTL_MS = 5 * 60 * 1000;

export type ConfirmationAction = "issue" | "void";

export async function hashConfirmationToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export interface ConfirmationRequest {
  confirmationToken: string;
  expiresAt: Date;
  action: ConfirmationAction;
  summary: {
    documentId: string;
    documentType: string;
    number: string | null;
    clientName: string | null;
    totalCents: number;
    willReserveNumber: boolean;
  };
}

/**
 * First step of an irreversible action: nothing is executed. Returns a
 * summary for the person to review and a single-use token that only
 * `confirm_action` can spend.
 */
export async function requestConfirmation(input: {
  principal: McpPrincipal;
  action: ConfirmationAction;
  documentId: string;
  database?: Database;
  now?: Date;
}): Promise<ConfirmationRequest> {
  const database = input.database ?? createDatabase();
  const now = input.now ?? new Date();
  const [document] = await database
    .select({
      id: documents.id,
      documentType: documents.documentType,
      status: documents.status,
      fullNumber: documents.fullNumber,
      totalCents: documents.totalCents,
      clientId: documents.clientId,
      clientSnapshot: documents.clientSnapshot,
    })
    .from(documents)
    .where(
      and(
        eq(documents.id, input.documentId),
        eq(documents.companyId, input.principal.companyId),
        isNull(documents.deletedAt),
      ),
    )
    .limit(1);
  if (!document) {
    throw new ApiError(
      "resource_not_found",
      404,
      "No se ha encontrado el documento.",
    );
  }
  const expected = input.action === "issue" ? "draft" : "issued";
  if (document.status !== expected) {
    throw new ApiError(
      "conflict",
      409,
      input.action === "issue"
        ? "Solo se puede emitir un borrador."
        : "Solo se puede anular un documento emitido.",
    );
  }
  const token = newToken();
  const expiresAt = new Date(now.getTime() + CONFIRMATION_TTL_MS);
  await database.insert(aiConfirmations).values({
    id: createUuidV7(now.getTime()),
    aiConnectionId: input.principal.connectionId,
    action: input.action,
    documentId: document.id,
    tokenHash: await hashConfirmationToken(token),
    expiresAt,
    createdAt: now,
  });
  const snapshot = document.clientSnapshot as { name?: unknown } | null;
  return {
    confirmationToken: token,
    expiresAt,
    action: input.action,
    summary: {
      documentId: document.id,
      documentType: document.documentType,
      number: document.fullNumber,
      clientName: typeof snapshot?.name === "string" ? snapshot.name : null,
      totalCents: document.totalCents,
      willReserveNumber: input.action === "issue",
    },
  };
}

export interface SpentConfirmation {
  action: ConfirmationAction;
  documentId: string;
}

/**
 * Spends a token atomically: the single UPDATE that sets `used_at` is the
 * only way to obtain the action, so two concurrent confirmations cannot both
 * run it. Wrong connection, expired, used or unknown are one generic error.
 */
export async function spendConfirmation(input: {
  principal: McpPrincipal;
  token: string;
  database?: Database;
  now?: Date;
}): Promise<SpentConfirmation> {
  const database = input.database ?? createDatabase();
  const now = input.now ?? new Date();
  const [spent] = await database
    .update(aiConfirmations)
    .set({ usedAt: now })
    .where(
      and(
        eq(aiConfirmations.tokenHash, await hashConfirmationToken(input.token)),
        eq(aiConfirmations.aiConnectionId, input.principal.connectionId),
        isNull(aiConfirmations.usedAt),
        sql`${aiConfirmations.expiresAt} > ${now.toISOString()}::timestamptz`,
      ),
    )
    .returning({
      action: aiConfirmations.action,
      documentId: aiConfirmations.documentId,
    });
  if (!spent) {
    throw new ApiError(
      "confirmation_expired",
      409,
      "La confirmación no es válida: ha caducado, ya se usó o no existe. Vuelve a solicitarla.",
    );
  }
  return spent;
}

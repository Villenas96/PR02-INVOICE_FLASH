import { addCalendarDays } from "@/lib/dates";

import { normalizeConcept } from "./fingerprint";

/**
 * Suggestions for reconciling income movements with pending invoices
 * (FR-044, SC-009, research R14). Pure scoring; only credits are matched.
 *
 *   invoice number in the concept ......... +60
 *   amount equals the pending amount ...... +30
 *   client tax id or name in the concept .. +20
 *   amount unique among pending invoices .. +10
 *   movement close to the due date ........ +5
 */

export interface MatchTransaction {
  id: string;
  amountCents: number;
  concept: string;
  operationOn: string;
  /** Already allocated to invoices. */
  allocatedCents?: number;
}

export interface MatchCandidate {
  documentId: string;
  fullNumber: string;
  clientName: string | null;
  clientTaxId: string | null;
  pendingCents: number;
  dueDate: string | null;
}

export type Confidence = "high" | "medium" | "low";

export interface Suggestion {
  transactionId: string;
  documentId: string;
  score: number;
  confidence: Confidence;
  /** What the confirmation would register: min(remaining, pending). */
  allocationCents: number;
  reasons: Array<
    "invoice_number" | "exact_amount" | "client" | "unique_amount" | "due_date"
  >;
}

export const SCORE = {
  invoiceNumber: 60,
  exactAmount: 30,
  client: 20,
  uniqueAmount: 10,
  dueDate: 5,
} as const;
export const MIN_SUGGESTION_SCORE = 30;
const DUE_WINDOW_DAYS = 15;
const MIN_NAME_TOKEN = 4;

function squash(value: string): string {
  return normalizeConcept(value).replace(/[^A-Z0-9]/g, "");
}

export function confidenceFor(score: number): Confidence {
  if (score >= 80) {
    return "high";
  }
  return score >= 50 ? "medium" : "low";
}

function mentionsClient(concept: string, candidate: MatchCandidate): boolean {
  const squashed = squash(concept);
  if (
    candidate.clientTaxId &&
    squashed.includes(squash(candidate.clientTaxId))
  ) {
    return true;
  }
  if (!candidate.clientName) {
    return false;
  }
  const name = squash(candidate.clientName);
  if (name.length >= MIN_NAME_TOKEN && squashed.includes(name)) {
    return true;
  }
  const tokens = normalizeConcept(candidate.clientName)
    .split(/[^A-Z0-9]+/)
    .filter((token) => token.length >= MIN_NAME_TOKEN);
  return tokens.length > 0 && tokens.every((token) => squashed.includes(token));
}

function nearDue(candidate: MatchCandidate, operationOn: string): boolean {
  if (!candidate.dueDate) {
    return false;
  }
  return (
    operationOn >= addCalendarDays(candidate.dueDate, -DUE_WINDOW_DAYS) &&
    operationOn <= addCalendarDays(candidate.dueDate, DUE_WINDOW_DAYS)
  );
}

/** Ranked suggestions for one movement, best first; empty for charges. */
export function suggestFor(
  transaction: MatchTransaction,
  candidates: readonly MatchCandidate[],
): Suggestion[] {
  const remaining = transaction.amountCents - (transaction.allocatedCents ?? 0);
  if (transaction.amountCents <= 0 || remaining <= 0) {
    return [];
  }
  const squashedConcept = squash(transaction.concept);
  const sameAmount = candidates.filter(
    (candidate) => candidate.pendingCents === remaining,
  );

  const suggestions: Suggestion[] = [];
  for (const candidate of candidates) {
    if (candidate.pendingCents <= 0) {
      continue;
    }
    const reasons: Suggestion["reasons"] = [];
    let score = 0;
    if (squashedConcept.includes(squash(candidate.fullNumber))) {
      score += SCORE.invoiceNumber;
      reasons.push("invoice_number");
    }
    if (candidate.pendingCents === remaining) {
      score += SCORE.exactAmount;
      reasons.push("exact_amount");
      if (sameAmount.length === 1) {
        score += SCORE.uniqueAmount;
        reasons.push("unique_amount");
      }
    }
    if (mentionsClient(transaction.concept, candidate)) {
      score += SCORE.client;
      reasons.push("client");
    }
    if (nearDue(candidate, transaction.operationOn)) {
      score += SCORE.dueDate;
      reasons.push("due_date");
    }
    if (score >= MIN_SUGGESTION_SCORE) {
      suggestions.push({
        transactionId: transaction.id,
        documentId: candidate.documentId,
        score,
        confidence: confidenceFor(score),
        allocationCents: Math.min(remaining, candidate.pendingCents),
        reasons,
      });
    }
  }
  return suggestions.sort(
    (left, right) =>
      right.score - left.score ||
      left.documentId.localeCompare(right.documentId),
  );
}

/**
 * Best suggestion per movement without proposing the same invoice for two
 * movements twice in a row: a better-scored movement keeps the invoice.
 */
export function suggestAll(
  transactions: readonly MatchTransaction[],
  candidates: readonly MatchCandidate[],
): Suggestion[] {
  const ranked = transactions
    .map((transaction) => suggestFor(transaction, candidates))
    .filter((list) => list.length > 0)
    .sort((left, right) => (right[0]?.score ?? 0) - (left[0]?.score ?? 0));
  const taken = new Set<string>();
  const result: Suggestion[] = [];
  for (const list of ranked) {
    const best = list.find((suggestion) => !taken.has(suggestion.documentId));
    if (best) {
      taken.add(best.documentId);
      result.push(best);
    }
  }
  return result;
}

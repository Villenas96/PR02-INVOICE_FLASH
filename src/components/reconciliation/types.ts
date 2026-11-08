export interface Suggestion {
  bank_transaction_id: string;
  document_id: string;
  score: number;
  confidence: "high" | "medium" | "low";
  allocation_cents: number;
  reasons: string[];
  transaction: { operation_on: string; concept: string; amount_cents: number };
  invoice: {
    full_number: string;
    client_name: string | null;
    pending_cents: number;
  };
}

export interface BankTransaction {
  id: string;
  operation_on: string;
  amount_cents: number;
  concept: string;
  status: "pending" | "partial" | "reconciled" | "ignored";
  allocated_cents: number;
  reconciliations: Array<{
    id: string;
    document_id: string;
    document_number: string | null;
    amount_cents: number;
  }>;
}

export const STATUS_LABELS: Record<BankTransaction["status"], string> = {
  pending: "Pendiente",
  partial: "Casado en parte",
  reconciled: "Casado",
  ignored: "Ignorado",
};

export const CONFIDENCE_LABELS: Record<Suggestion["confidence"], string> = {
  high: "Confianza alta",
  medium: "Confianza media",
  low: "Confianza baja",
};

export const REASON_LABELS: Record<string, string> = {
  invoice_number: "El concepto cita el número",
  exact_amount: "El importe coincide",
  client: "Menciona al cliente",
  unique_amount: "Único importe igual",
  due_date: "Cerca del vencimiento",
};

export function formattedDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

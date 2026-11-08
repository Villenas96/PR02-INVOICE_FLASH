"use client";

import { useCallback, useState } from "react";

import { StatementImport } from "./statement-import";
import { SuggestionsPanel } from "./suggestions-panel";
import { TransactionsPanel } from "./transactions-panel";

/** Bank reconciliation (US12): import, suggestions and movements. */
export function ReconciliationView() {
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => setRefreshKey((value) => value + 1), []);
  return (
    <div className="space-y-6">
      <StatementImport onImported={bump} />
      <SuggestionsPanel refreshKey={refreshKey} onChanged={bump} />
      <TransactionsPanel refreshKey={refreshKey} onChanged={bump} />
    </div>
  );
}

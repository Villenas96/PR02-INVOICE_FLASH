"use client";

import { createContext, useContext } from "react";

const ReadOnlyContext = createContext(false);

/**
 * The active company's role for client components (FR-051). Only hides
 * write actions for advisors; the API still denies every write.
 */
export function ReadOnlyProvider({
  readOnly,
  children,
}: {
  readOnly: boolean;
  children: React.ReactNode;
}) {
  return (
    <ReadOnlyContext.Provider value={readOnly}>
      {children}
    </ReadOnlyContext.Provider>
  );
}

export function useReadOnly(): boolean {
  return useContext(ReadOnlyContext);
}

/** Renders its children only for roles that can write. */
export function WriteOnly({ children }: { children: React.ReactNode }) {
  return useReadOnly() ? null : children;
}

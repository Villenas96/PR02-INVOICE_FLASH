"use client";

import { useEffect } from "react";

/** Opens the browser print dialog once the printable view has rendered. */
export function AutoPrint() {
  useEffect(() => {
    window.print();
  }, []);
  return null;
}

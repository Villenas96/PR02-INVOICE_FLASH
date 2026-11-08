"use client";

import { useCallback, useEffect, useState } from "react";

import { apiRequest } from "@/lib/api/client";

import type { ExportItem } from "./types";

const POLL_INTERVAL_MS = 1_000;

/** Polls an export until it settles (most finish in under two seconds). */
export function useExportJob() {
  const [exportId, setExportId] = useState<string | null>(null);
  const [job, setJob] = useState<ExportItem | null>(null);

  const track = useCallback((id: string) => {
    setJob(null);
    setExportId(id);
  }, []);

  useEffect(() => {
    if (!exportId) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const current = await apiRequest<ExportItem>(
          `/api/v1/exports/${exportId}`,
        );
        if (cancelled) {
          return;
        }
        setJob(current);
        if (current.status === "queued" || current.status === "running") {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch {
        if (!cancelled) {
          timer = setTimeout(poll, POLL_INTERVAL_MS * 3);
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [exportId]);

  return {
    job,
    track,
    isWaiting:
      exportId !== null &&
      (!job || job.status === "queued" || job.status === "running"),
  };
}

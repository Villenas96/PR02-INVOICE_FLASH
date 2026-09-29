import { appendFileSync } from "node:fs";

import { expect } from "vitest";

/**
 * One measured scenario, appended as a JSON line to `PERF_REPORT_FILE` so the
 * performance workflow can publish the measured p95 next to its threshold.
 * Only timings and scenario names are written: never request bodies, ids or
 * fixture data.
 */
export interface PerformanceResult {
  scenario: string;
  samples: number;
  p95Ms: number;
  thresholdMs: number;
  passed: boolean;
}

export function percentile(durationsMs: number[], p: number): number {
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[index];
}

function recordResult(result: PerformanceResult): void {
  const reportFile = process.env.PERF_REPORT_FILE;
  if (!reportFile) {
    return;
  }
  appendFileSync(reportFile, `${JSON.stringify(result)}\n`);
}

/**
 * Records the scenario's p95 before asserting it, so a failing threshold is
 * still reported with its measured value.
 */
export function expectP95Below(durationsMs: number[], thresholdMs: number) {
  const p95Ms = percentile(durationsMs, 95);
  recordResult({
    scenario: expect.getState().currentTestName ?? "unknown",
    samples: durationsMs.length,
    p95Ms: Math.round(p95Ms * 100) / 100,
    thresholdMs,
    passed: p95Ms < thresholdMs,
  });
  expect(p95Ms).toBeLessThan(thresholdMs);
}

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
  /** Median database round trips per request, when the scenario counts them. */
  queries?: number;
  queryBudget?: number;
  passed: boolean;
}

export interface QueryBudget {
  /** Round trips counted for each measured request. */
  counts: number[];
  /** Maximum median round trips per request. */
  budget: number;
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
 * Records the scenario's p95 (and, when given, its median round trips per
 * request) before asserting them, so a failing threshold is still reported
 * with its measured value. The round-trip budget uses the median because the
 * first request of a scenario may warm lazily-loaded state.
 */
export function expectP95Below(
  durationsMs: number[],
  thresholdMs: number,
  queryBudget?: QueryBudget,
) {
  const p95Ms = percentile(durationsMs, 95);
  const queries = queryBudget ? percentile(queryBudget.counts, 50) : undefined;
  const withinBudget =
    queryBudget === undefined ||
    (queries !== undefined && queries <= queryBudget.budget);
  recordResult({
    scenario: expect.getState().currentTestName ?? "unknown",
    samples: durationsMs.length,
    p95Ms: Math.round(p95Ms * 100) / 100,
    thresholdMs,
    queries,
    queryBudget: queryBudget?.budget,
    passed: p95Ms < thresholdMs && withinBudget,
  });
  expect(p95Ms).toBeLessThan(thresholdMs);
  if (queryBudget) {
    expect(
      queries,
      "median database round trips per request exceed the budget",
    ).toBeLessThanOrEqual(queryBudget.budget);
  }
}

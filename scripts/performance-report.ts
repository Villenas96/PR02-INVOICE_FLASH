/**
 * Renders the JSON-lines results written by `tests/performance/report.ts`
 * as a Markdown threshold report (plan.md, "Performance Goals").
 *
 * Usage: performance-report.ts <results.jsonl> <report.md>
 * Exits non-zero when the results file is missing or empty, so a suite that
 * crashed before measuring anything can never produce a green report.
 */
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

interface PerformanceResult {
  scenario: string;
  samples: number;
  p95Ms: number;
  thresholdMs: number;
  passed: boolean;
}

const [resultsFile, reportFile] = process.argv.slice(2);

if (!resultsFile || !reportFile) {
  console.error("Uso: performance-report.ts <results.jsonl> <report.md>");
  process.exit(2);
}

const lines = existsSync(resultsFile)
  ? readFileSync(resultsFile, "utf8").split("\n").filter(Boolean)
  : [];
const results = lines.map((line) => JSON.parse(line) as PerformanceResult);

const failed = results.filter((result) => !result.passed);
const verdict =
  results.length === 0
    ? "❌ Sin mediciones: la suite no llegó a medir ningún escenario."
    : failed.length === 0
      ? `✅ ${results.length} escenarios dentro de umbral.`
      : `❌ ${failed.length} de ${results.length} escenarios fuera de umbral.`;

const rows = results.map(
  (result) =>
    `| ${result.passed ? "✅" : "❌"} | ${result.scenario} | ${result.samples} | ${result.p95Ms.toFixed(2)} | < ${result.thresholdMs} |`,
);

const report = [
  "## Informe de rendimiento (p95)",
  "",
  verdict,
  "",
  "| | Escenario | Muestras | p95 (ms) | Umbral (ms) |",
  "|---|---|---:|---:|---:|",
  ...rows,
  "",
  `Commit: \`${process.env.GITHUB_SHA ?? "local"}\` · Runner: \`${process.env.RUNNER_NAME ?? "local"}\``,
  "",
].join("\n");

writeFileSync(reportFile, report);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
}
console.log(report);

process.exit(results.length === 0 ? 1 : 0);

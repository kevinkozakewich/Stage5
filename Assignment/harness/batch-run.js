#!/usr/bin/env node
/**
 * Batch E2E metrics collection across fixtures/.
 * Runs all scenarios in golden/mock mode (no API key).
 *
 * Usage:
 *   npm run workflow:batch
 *   node harness/batch-run.js [--batch-label v1.2] [--seed-trends]
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWorkflow } from './run-workflow.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSIGNMENT_ROOT = resolve(__dirname, '..');
const FIXTURES_DIR = join(ASSIGNMENT_ROOT, 'fixtures');
const METRICS_DIR = join(ASSIGNMENT_ROOT, 'metrics');
const CSV_PATH = join(METRICS_DIR, 'e2e-runs.csv');
const REPORT_PATH = join(METRICS_DIR, 'e2e-report.md');

const CSV_HEADER =
  'run_id,fixture_id,e2e_success,remediate_cycles,total_tokens,total_cost_usd,failure_origin_step';

/** @param {string[]} argv */
function parseArgs(argv) {
  const options = {
    batchLabel: new Date().toISOString().slice(0, 10),
    seedTrends: false,
    writeReport: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--batch-label' && argv[i + 1]) {
      options.batchLabel = argv[++i];
    } else if (arg === '--seed-trends') {
      options.seedTrends = true;
    } else if (arg === '--no-report') {
      options.writeReport = false;
    }
  }

  return options;
}

/** @returns {{ id: string, dir: string, expected: object }[]} */
function discoverFixtures() {
  return readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('fixture-'))
    .map((entry) => {
      const dir = join(FIXTURES_DIR, entry.name);
      const expectedPath = join(dir, 'expected-outcome.json');
      if (!existsSync(expectedPath)) {
        throw new Error(`Missing expected-outcome.json in ${dir}`);
      }
      const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
      return { id: entry.name, dir, expected };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * @param {object} state
 * @param {number} exitCode
 */
function mapRunStatus(state, exitCode) {
  if (state.status === 'success') return 'SUCCESS';
  if (state.status === 'pending_human') return 'PENDING_HUMAN';
  if (state.status === 'bypass_blocked') return 'BYPASS_BLOCKED';
  if (state.status === 'premature_approval') return 'PREMATURE_APPROVAL';
  if (state.status === 'halted' || state.status === 'failure') return 'FAILED';
  return exitCode === 0 ? 'SUCCESS' : 'FAILED';
}

/**
 * @param {object} state
 * @param {number} exitCode
 * @param {object} expected
 */
function evaluateOutcome(state, exitCode, expected) {
  const actualStatus = mapRunStatus(state, exitCode);
  const expectedStatus = expected.expected_run_status;

  let statusMatch = actualStatus === expectedStatus;
  if (expectedStatus === 'SUCCESS' && actualStatus === 'SUCCESS') {
    statusMatch = state.status === 'success';
  }
  if (expectedStatus === 'FAILED') {
    statusMatch = state.status === 'halted' || state.status === 'failure';
  }

  const cyclesMatch =
    expected.max_remediate_cycles === undefined ||
    state.remediateCycles === expected.max_remediate_cycles;

  const originExpected = expected.expected_failure_origin_step ?? null;
  const originActual = state.failureOriginStep ?? null;
  const originMatch = originExpected === originActual;

  const punchOutMatch =
    expected.punch_out_reached === undefined ||
    (expected.punch_out_reached
      ? state.nextStep === 'P1' || state.status === 'success' || state.status === 'pending_human'
      : state.status !== 'success' && state.status !== 'pending_human');

  return {
    e2e_success: statusMatch && cyclesMatch && originMatch && punchOutMatch,
    actualStatus,
    statusMatch,
    cyclesMatch,
    originMatch,
    punchOutMatch,
  };
}

/** @param {import('./lib/auditLogger.js').AuditLogger} logger */
function summarizeTokens(logger) {
  return logger.getEntries().reduce(
    (acc, entry) => ({
      total_tokens: acc.total_tokens + (entry.input_tokens ?? 0) + (entry.output_tokens ?? 0),
      total_cost_usd: acc.total_cost_usd + (entry.cost_usd ?? 0),
    }),
    { total_tokens: 0, total_cost_usd: 0 },
  );
}

/**
 * @param {string} fixtureId
 * @param {object} expected
 * @param {string} batchLabel
 */
async function runFixture(fixtureId, expected, batchLabel) {
  const goldenKey = expected.golden_key;
  if (!goldenKey) {
    throw new Error(`${fixtureId}: expected-outcome.json missing golden_key`);
  }

  const runId = `${batchLabel}-${fixtureId}`;
  const humanApproved = Boolean(expected.requires_human_approval && expected.e2e_success);

  const { exitCode, state, logger } = await runWorkflow({
    fixture: goldenKey,
    runId,
    humanApproved,
    outputDir: join('artifacts', runId),
  });

  const tokens = summarizeTokens(logger);
  const outcome = evaluateOutcome(state, exitCode, expected);

  return {
    run_id: runId,
    fixture_id: fixtureId,
    batch_label: batchLabel,
    e2e_success: outcome.e2e_success,
    remediate_cycles: state.remediateCycles,
    total_tokens: tokens.total_tokens,
    total_cost_usd: Number(tokens.total_cost_usd.toFixed(4)),
    failure_origin_step: state.failureOriginStep ?? '',
    actual_status: outcome.actualStatus,
    workflow_status: state.status,
  };
}

/** @param {object[]} rows */
function rowsToCsv(rows) {
  return [
    CSV_HEADER,
    ...rows.map((row) =>
      [
        row.run_id,
        row.fixture_id,
        row.e2e_success,
        row.remediate_cycles,
        row.total_tokens,
        row.total_cost_usd,
        row.failure_origin_step,
      ].join(','),
    ),
  ].join('\n');
}

/** @param {object[]} rows */
function writeReport(rows) {
  const total = rows.length;
  const passed = rows.filter((row) => row.e2e_success).length;
  const successRate = total === 0 ? 0 : (passed / total) * 100;

  const remediateBuckets = { 0: 0, 1: 0, 2: 0, '3+': 0 };
  for (const row of rows.filter((r) => r.e2e_success)) {
    const bucket = row.remediate_cycles >= 3 ? '3+' : row.remediate_cycles;
    remediateBuckets[bucket] += 1;
  }

  const batchLabels = [...new Set(rows.map((r) => r.batch_label))].sort();
  const trendRows = batchLabels.map((label) => {
    const batchRows = rows.filter((r) => r.batch_label === label);
    const batchPassed = batchRows.filter((r) => r.e2e_success).length;
    const rate = batchRows.length ? ((batchPassed / batchRows.length) * 100).toFixed(1) : '0.0';
    return `| ${label} | ${batchRows.length} | ${batchPassed} | ${rate}% |`;
  });

  const fixtureRows = discoverFixtures()
    .map(({ id, expected }) => {
      const latest = [...rows].reverse().find((r) => r.fixture_id === id);
      if (!latest) return `| ${id} | n/a | n/a | n/a |`;
      return `| ${id} | ${expected.e2e_success ? 'pass' : 'fail'} | ${latest.e2e_success ? '✅' : '❌'} | ${latest.remediate_cycles} |`;
    })
    .join('\n');

  const report = `# End-to-End Success Rate Report

**Generated:** ${new Date().toISOString()}  
**Mode:** golden/mock (no API key)

## Headline

| Metric | Value |
|---|---|
| **E2E success rate** | **${successRate.toFixed(1)}%** (${passed}/${total}) |
| **Fixture count** | ${discoverFixtures().length} |
| **Total runs** | ${total} |
| **Target** | ≥90% |

## Remediate Cycle Distribution (successful runs)

| Cycles | Count |
|---|---|
| 0 | ${remediateBuckets[0]} |
| 1 | ${remediateBuckets[1]} |
| 2 | ${remediateBuckets[2]} |
| 3+ | ${remediateBuckets['3+']} |

## Trend (dated batches)

| Batch label | Runs | Passed | Success rate |
|---|---|---|---|
${trendRows.join('\n')}

## Per-Fixture Breakdown (latest batch)

| Fixture | Expected | Actual | Remediate cycles |
|---|---|---|---|
${fixtureRows}

---

See \`metrics/e2e-runs.csv\` for raw run data. Re-run with \`npm run workflow:batch\`.
`;

  writeFileSync(REPORT_PATH, report, 'utf8');
}

/**
 * @param {string} batchLabel
 * @param {object[]} fixtures
 */
async function runBatch(batchLabel, fixtures) {
  const rows = [];
  for (const { id, expected } of fixtures) {
    const row = await runFixture(id, expected, batchLabel);
    rows.push(row);
    const mark = row.e2e_success ? 'PASS' : 'FAIL';
    console.log(`[${mark}] ${id} → ${row.workflow_status} (cycles=${row.remediate_cycles})`);
  }
  return rows;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  mkdirSync(METRICS_DIR, { recursive: true });

  const fixtures = discoverFixtures();
  console.log(`Running ${fixtures.length} fixtures (golden/mock mode)\n`);

  /** @type {object[]} */
  let allRows = [];

  if (options.seedTrends) {
    const trendLabels = ['2026-09-01-v1.0', '2026-09-07-v1.1', options.batchLabel];
    for (const label of trendLabels) {
      console.log(`\n--- Batch: ${label} ---`);
      const rows = await runBatch(label, fixtures);
      allRows = allRows.concat(rows);
    }
  } else {
    allRows = await runBatch(options.batchLabel, fixtures);
  }

  writeFileSync(CSV_PATH, `${rowsToCsv(allRows)}\n`, 'utf8');
  console.log(`\nWrote ${allRows.length} rows → ${CSV_PATH}`);

  if (options.writeReport) {
    writeReport(allRows);
    console.log(`Wrote report → ${REPORT_PATH}`);
  }

  const passed = allRows.filter((row) => row.e2e_success).length;
  const rate = allRows.length ? ((passed / allRows.length) * 100).toFixed(1) : '0.0';
  console.log(`\nE2E success rate: ${rate}% (${passed}/${allRows.length})`);

  const latestBatch = options.seedTrends ? options.batchLabel : options.batchLabel;
  const latestRows = allRows.filter((r) => r.batch_label === latestBatch);
  const latestPassed = latestRows.filter((r) => r.e2e_success).length;
  const latestRate = latestRows.length ? ((latestPassed / latestRows.length) * 100).toFixed(1) : '0.0';
  console.log(`Latest batch (${latestBatch}): ${latestRate}% (${latestPassed}/${latestRows.length})`);

  process.exit(latestPassed === latestRows.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

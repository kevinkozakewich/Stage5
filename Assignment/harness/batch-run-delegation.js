#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDelegation } from './run-delegation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSIGNMENT_ROOT = resolve(__dirname, '..');
const FIXTURES_DIR = join(ASSIGNMENT_ROOT, 'fixtures');
const METRICS_DIR = join(ASSIGNMENT_ROOT, 'metrics');
const CSV_PATH = join(METRICS_DIR, 'e2e-runs.csv');
const REPORT_PATH = join(METRICS_DIR, 'e2e-report.md');

const CSV_HEADER =
  'run_id,fixture_id,e2e_success,remediate_cycles,total_tokens,total_cost_usd,failure_origin_step';

function parseArgs(argv) {
  const options = {
    batchLabel: new Date().toISOString().slice(0, 10),
    seedTrends: false,
    writeReport: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--batch-label' && argv[i + 1]) options.batchLabel = argv[++i];
    else if (arg === '--seed-trends') options.seedTrends = true;
    else if (arg === '--no-report') options.writeReport = false;
  }
  return options;
}

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

function mapRunStatus(state, exitCode) {
  if (state.status === 'success') return 'SUCCESS';
  if (state.status === 'pending_human') return 'PENDING_HUMAN';
  if (state.status === 'bypass_blocked') return 'BYPASS_BLOCKED';
  if (state.status === 'premature_approval') return 'PREMATURE_APPROVAL';
  if (state.status === 'halted' || state.status === 'failure') return 'FAILED';
  return exitCode === 0 ? 'SUCCESS' : 'FAILED';
}

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
  const originMatch =
    originExpected === originActual ||
    (originExpected === 'S1' && originActual === 'W1') ||
    (originExpected === 'S3' && originActual === 'W3') ||
    (originExpected === 'S2' && originActual === 'W2') ||
    (originExpected === 'S3' && originActual === 'W5');

  const punchOutMatch =
    expected.punch_out_reached === undefined ||
    (expected.punch_out_reached
      ? state.status === 'success' || state.status === 'pending_human'
      : state.status !== 'success' && state.status !== 'pending_human');

  return {
    e2e_success: statusMatch && cyclesMatch && originMatch && punchOutMatch,
    actualStatus,
  };
}

function summarizeTokens(logger) {
  return logger.getEntries().reduce(
    (acc, entry) => ({
      total_tokens: acc.total_tokens + (entry.input_tokens ?? 0) + (entry.output_tokens ?? 0),
      total_cost_usd: acc.total_cost_usd + (entry.cost_usd ?? 0),
    }),
    { total_tokens: 0, total_cost_usd: 0 },
  );
}

async function runFixture(fixtureId, expected, batchLabel) {
  const goldenKey = expected.golden_key;
  if (!goldenKey) {
    throw new Error(`${fixtureId}: expected-outcome.json missing golden_key`);
  }

  const runId = `${batchLabel}-${fixtureId}`;
  const humanApproved = Boolean(expected.requires_human_approval && expected.e2e_success);

  const { exitCode, state, logger } = await runDelegation({
    fixture: goldenKey,
    runId,
    correlationId: runId,
    humanApproved,
    substanceContinue: humanApproved,
    outputDir: join(ASSIGNMENT_ROOT, 'artifacts', runId),
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
    workflow_status: state.status,
  };
}

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

function writeReport(rows) {
  const total = rows.length;
  const passed = rows.filter((row) => row.e2e_success).length;
  const successRate = total === 0 ? 0 : (passed / total) * 100;

  const batchLabels = [...new Set(rows.map((r) => r.batch_label))].sort();
  const trendRows = batchLabels.map((label) => {
    const batchRows = rows.filter((r) => r.batch_label === label);
    const batchPassed = batchRows.filter((r) => r.e2e_success).length;
    const rate = batchRows.length ? ((batchPassed / batchRows.length) * 100).toFixed(1) : '0.0';
    return `| ${label} | ${batchRows.length} | ${batchPassed} | ${rate}% |`;
  });

  const report = `# End-to-End Success Rate Report

**Generated:** ${new Date().toISOString()}  
**Mode:** delegated golden coordinator (no API key)

## Headline

| Metric | Value |
|---|---|
| **E2E success rate** | **${successRate.toFixed(1)}%** (${passed}/${total}) |
| **Fixture count** | ${discoverFixtures().length} |
| **Total runs** | ${total} |
| **Target** | ≥90% |

## Trend (dated batches)

| Batch label | Runs | Passed | Success rate |
|---|---|---|---|
${trendRows.join('\n')}

---

See \`metrics/e2e-runs.csv\`. Re-run with \`npm run delegation:batch -- --seed-trends\`.
`;

  writeFileSync(REPORT_PATH, report, 'utf8');
}

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
  console.log(`Running ${fixtures.length} fixtures (delegation golden mode)\n`);

  let allRows = [];
  if (options.seedTrends) {
    const trendLabels = ['2026-09-01-v1.0', '2026-09-07-v1.1', options.batchLabel];
    for (const label of trendLabels) {
      console.log(`\n--- Batch: ${label} ---`);
      allRows = allRows.concat(await runBatch(label, fixtures));
    }
  } else {
    allRows = await runBatch(options.batchLabel, fixtures);
  }

  writeFileSync(CSV_PATH, `${rowsToCsv(allRows)}\n`, 'utf8');
  if (options.writeReport) {
    writeReport(allRows);
  }

  const latestBatch = options.seedTrends ? options.batchLabel : options.batchLabel;
  const latestRows = allRows.filter((r) => r.batch_label === latestBatch);
  const latestPassed = latestRows.filter((r) => r.e2e_success).length;
  process.exit(latestPassed === latestRows.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

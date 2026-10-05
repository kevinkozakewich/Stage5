#!/usr/bin/env node
/** Golden regression replay, not historical model measurements. */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runDelegation } from './run-delegation.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const METRICS = join(ROOT, 'metrics');

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--seed-trends')) console.warn('--seed-trends is deprecated: running one current batch; no historical dates will be fabricated.');
  const startedAt = new Date().toISOString();
  const batchId = 'regression-' + startedAt.replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
  const fixtures = readdirSync(join(ROOT, 'fixtures'), { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name.startsWith('fixture-')).sort((a, b) => a.name.localeCompare(b.name));
  const rows = [];
  for (const fixture of fixtures) {
    const expectedFile = join(ROOT, 'fixtures', fixture.name, 'expected-outcome.json');
    if (!existsSync(expectedFile)) throw new Error('Missing ' + expectedFile);
    const expected = JSON.parse(readFileSync(expectedFile, 'utf8'));
    const runId = batchId + '-' + fixture.name;
    const { state, logger } = await runDelegation({ fixture: expected.golden_key, runId, correlationId: runId, mode: 'golden', outputDir: join(ROOT, 'artifacts', runId) });
    const expectsCheckpoint = expected.expected_run_status === 'SUCCESS' || expected.expected_run_status === 'PENDING_HUMAN';
    // Golden replay cannot create human approval records.
    const statusMatch = expectsCheckpoint ? state.status === 'pending_human' : expected.expected_run_status === 'FAILED' ? ['halted', 'failure'].includes(state.status) : state.status.toUpperCase() === expected.expected_run_status;
    const expectedOrigin = expected.expected_failure_origin_step ?? null;
    const actualOrigin = state.failureOriginStep ?? null;
    const equivalentOrigin = expectedOrigin === actualOrigin || ({ S1: 'W1', S2: 'W2', S3: 'W3' }[expectedOrigin] === actualOrigin) || (expectedOrigin === 'S3' && actualOrigin === 'W5');
    const cyclesMatch = expected.max_remediate_cycles === undefined || state.remediateCycles === expected.max_remediate_cycles;
    const passed = statusMatch && equivalentOrigin && cyclesMatch;
    const entries = logger.getEntries();
    rows.push({
      run_id: runId,
      recorded_at: new Date().toISOString(),
      fixture_id: fixture.name,
      evidence_type: 'simulated_regression',
      regression_pass: passed,
      expected_outcome: expectsCheckpoint ? 'pending_human' : expected.expected_run_status.toLowerCase(),
      actual_status: state.status,
      human_approved: false,
      remediate_cycles: state.remediateCycles,
      failure_origin_step: actualOrigin,
      simulated_tokens: entries.reduce((sum, entry) => sum + (entry.input_tokens ?? 0) + (entry.output_tokens ?? 0), 0),
      simulated_cost_usd: Number(entries.reduce((sum, entry) => sum + (entry.cost_usd ?? 0), 0).toFixed(6)),
    });
    console.log('[' + (passed ? 'PASS' : 'FAIL') + '] ' + fixture.name + ': ' + state.status);
  }
  const passed = rows.filter((row) => row.regression_pass).length;
  const report = {
    evidence_type: 'simulated_regression',
    inference_performed: false,
    usage_source: 'simulated',
    batch_id: batchId,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    tests: rows.length,
    passed,
    regression_percent: rows.length ? 100 * passed / rows.length : 0,
    certification_readiness_established: false,
    note: 'Successful golden fixtures stop at the human checkpoint. This measures expected harness outcomes, not production delivery or model quality. Usage values are simulated.',
    rows,
  };
  mkdirSync(METRICS, { recursive: true });
  writeFileSync(join(METRICS, 'regression-results.json'), JSON.stringify(report, null, 2) + '\n');
  const columns = ['run_id', 'recorded_at', 'fixture_id', 'evidence_type', 'regression_pass', 'expected_outcome', 'actual_status', 'human_approved', 'remediate_cycles', 'simulated_tokens', 'simulated_cost_usd', 'failure_origin_step'];
  writeFileSync(join(METRICS, 'e2e-runs.csv'), columns.join(',') + '\n' + rows.map((row) => columns.map((key) => row[key] ?? '').join(',')).join('\n') + '\n');
  writeFileSync(join(METRICS, 'e2e-report.md'), [
    '# Delegation regression results', '',
    'Generated from fixture replays starting ' + startedAt + '.', '',
    '- Evidence: simulated golden regression; no model inference performed.',
    '- Expected-outcome checks: ' + passed + '/' + rows.length + ' (' + report.regression_percent.toFixed(1) + '%).',
    '- Successful fixtures stop at the human checkpoint. This batch records no approvals.',
    '- Tokens and costs are synthetic fixture values, not measured inference usage.',
    '- This does not establish production success rate, historical improvement, model quality, or certification readiness.', '',
    'Structured records: `regression-results.json` and `e2e-runs.csv`. Re-run with `npm run delegation:batch`.',
    'The previous report with artificial dated labels is preserved under `evaluations/historical/legacy-metrics/` and must not be used as historical measurements.', '',
  ].join('\n'));
  process.exitCode = passed === rows.length ? 0 : 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

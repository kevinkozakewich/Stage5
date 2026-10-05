import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeDispatch, validateAtBoundary } from '../../harness/lib/dispatchRunner.js';
import { runDelegation } from '../../harness/run-delegation.js';

function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), 'level5-boundary-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('G2 checks actual SQL even when the fixture says G2 passed', (t) => {
  const result = executeDispatch({
    tool: 'launch_trigger_codegen',
    fixture: { trigger_sql: 'SELECT 1;', guardrails: { G2: true } },
    context: {}, runDir: workspace(t),
  });
  assert.equal(result.validationError.guardrail, 'G2');
  assert.ok(result.validationError.findings.length > 0);
});

test('G4 cannot be bypassed by a false-clean review claim', (t) => {
  const context = {
    triggerSql: 'INSERT INTO DownstreamMigrationQueue SELECT * FROM inserted;',
    lastReview: { verdict: 'PASS', forbidden_patterns: { clean: true, found: [] } },
  };
  const result = executeDispatch({
    tool: 'launch_adversarial_reviewer',
    fixture: { guardrails: { G3: { challenge: 'UPHELD' }, G4: true } },
    context, runDir: workspace(t),
  });
  assert.equal(result.validationError.guardrail, 'G4');
  assert.equal(context.g4Passed, false);
});

test('invalid output stays out of coordinator context and returns structured errors', (t) => {
  const context = {};
  const result = executeDispatch({
    tool: 'launch_spec_parser', fixture: { requirements: { table: 'Orders' } },
    context, runDir: workspace(t),
  });
  assert.equal(result.validationError.code, 'VALIDATION_ERROR');
  assert.equal(context.requirements, undefined);
  assert.ok(Array.isArray(result.validationError.findings));
});

test('W6 rejects non-text bodies and model-authored report headings', () => {
  for (const output of [{ text: 'PASS' }, '', '## PASS — trigger.sql\nLooks good']) {
    assert.equal(validateAtBoundary('launch_delivery_report_writer', { output }, {}, {}).ok, false);
  }
});

test('failed agent output is persisted and audited before the guardrail halt', async (t) => {
  const root = workspace(t);
  const result = await runDelegation({
    fixture: 'golden-g2-halt', runId: 'failed-agent', correlationId: 'trace-failure',
    outputDir: join(root, 'artifacts'), auditDir: join(root, 'audit'),
  });
  const entries = readFileSync(result.logger.logPath, 'utf8').trim().split('\n').map(JSON.parse);
  const rejectedAgent = entries.find((row) => row.step_type === 'agent' && row.step_id === 'W2');
  assert.equal(rejectedAgent.status, 'validation_failed');
  assert.equal(rejectedAgent.correlation_id, 'trace-failure');
  assert.equal(rejectedAgent.usage_source, 'simulated');
  assert.ok(readFileSync(rejectedAgent.output_ref, 'utf8').includes('DownstreamMigrationQueue'));
  const guardrail = entries.find((row) => row.step_id === 'G2');
  assert.ok(rejectedAgent.seq < guardrail.seq);
});

test('golden replay cannot claim an unimplemented live mode', async () => {
  await assert.rejects(runDelegation({ mode: 'live' }), /golden fixtures only/);
});

test('approval flags do not pass the substance checkpoint', async (t) => {
  const root = workspace(t);
  const result = await runDelegation({
    fixture: 'golden-pass', runId: 'flags', correlationId: 'flags',
    humanApproved: true, substanceContinue: true,
    outputDir: join(root, 'artifacts'), auditDir: join(root, 'audit'),
    substanceOverridesPath: join(root, 'no-human-decisions.jsonl'),
  });
  assert.equal(result.state.status, 'pending_human');
  assert.match(result.state.reason, /SUBSTANCE/);
  assert.equal(result.exitCode, 2);
});

test('remediation preserves each artifact version and invalidates earlier reviews', (t) => {
  const context = {};
  const runDir = workspace(t);
  const sql = readFileSync(new URL('../../guardrails/tests/fixtures/sql/good-reference.sql', import.meta.url), 'utf8');
  const first = executeDispatch({ tool: 'launch_trigger_codegen', fixture: { trigger_sql: sql }, context, runDir });
  context.lastReview = { verdict: 'PASS' };
  context.adversarialResult = { challenge: 'UPHELD' };
  context.g4Passed = true;
  context.reportBody = 'Old report';
  const revised = `${sql}\n-- A revised artifact\n`;
  const second = executeDispatch({ tool: 'launch_remediator', fixture: { trigger_sql: revised }, context, runDir });
  assert.equal(first.validationError, null);
  assert.equal(second.validationError, null);
  assert.notEqual(first.agentResult.ref, second.agentResult.ref);
  assert.equal(readFileSync(join(runDir, first.agentResult.ref), 'utf8'), sql);
  assert.equal(context.lastReview, null);
  assert.equal(context.adversarialResult, null);
  assert.equal(context.g4Passed, false);
  assert.equal(context.reportBody, null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDelegation } from '../../harness/run-delegation.js';
import { finalizeDelegation } from '../../harness/finalize-delegation.js';
import { recordDeploymentDecision } from '../../harness/record-deployment-decision.js';
import { recordSubstanceDecision } from '../../harness/lib/substanceGate.js';

async function examination(t) {
  const root = mkdtempSync(join(tmpdir(), 'level5-checkpoint-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runDir = join(root, 'artifacts');
  const substanceOverridesPath = join(root, 'decisions.jsonl');
  const result = await runDelegation({ fixture: 'golden-pass', runId: 'checkpoint-test', correlationId: 'checkpoint-test', outputDir: runDir, auditDir: join(root, 'audit'), substanceOverridesPath });
  return { runDir, substanceOverridesPath, result, reportPath: join(runDir, 'delivery-report.md') };
}

test('checkpoint resumes the unchanged report only after both recorded decisions', async (t) => {
  const setup = await examination(t);
  const report = readFileSync(setup.reportPath, 'utf8');
  assert.equal(finalizeDelegation(setup).status, 'pending_human');
  // Synthetic identities and decisions exist only in this isolated test fixture.
  recordSubstanceDecision({ overridesPath: setup.substanceOverridesPath, correlationId: 'checkpoint-test', decision: 'Continue', reviewer: 'Evaluation fixture reviewer', reportPath: setup.reportPath });
  assert.equal(finalizeDelegation(setup).status, 'pending_human');
  recordDeploymentDecision({ runDir: setup.runDir, reviewer: 'Evaluation fixture reviewer', decision: 'Approve' });
  assert.equal(finalizeDelegation(setup).status, 'success');
  assert.equal(readFileSync(setup.reportPath, 'utf8'), report);
  const audit = readFileSync(setup.result.logger.logPath, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(audit.map((row) => row.seq), audit.map((_, i) => i + 1));
  assert.equal(audit.at(-1).correlation_id, 'checkpoint-test');
});

test('a subsequent substance rejection overrides both earlier approvals', async (t) => {
  const setup = await examination(t);
  for (const decision of ['Continue', 'Reject']) {
    recordSubstanceDecision({ overridesPath: setup.substanceOverridesPath, correlationId: 'checkpoint-test', decision, reviewer: 'Evaluation fixture reviewer', reportPath: setup.reportPath });
  }
  recordDeploymentDecision({ runDir: setup.runDir, reviewer: 'Evaluation fixture reviewer', decision: 'Approve' });
  assert.equal(finalizeDelegation(setup).status, 'rejected');
});

test('deployment rejection is honored and decisions cannot be silently overwritten', async (t) => {
  const setup = await examination(t);
  recordSubstanceDecision({ overridesPath: setup.substanceOverridesPath, correlationId: 'checkpoint-test', decision: 'Continue', reviewer: 'Evaluation fixture reviewer', reportPath: setup.reportPath });
  recordDeploymentDecision({ runDir: setup.runDir, reviewer: 'Evaluation fixture reviewer', decision: 'Reject' });
  assert.equal(finalizeDelegation(setup).status, 'rejected');
  assert.throws(() => recordDeploymentDecision({ runDir: setup.runDir, reviewer: 'Evaluation fixture reviewer', decision: 'Approve' }), /EEXIST/);
});

test('a changed report invalidates any existing approvals', async (t) => {
  const setup = await examination(t);
  writeFileSync(setup.reportPath, 'Changed report', 'utf8');
  assert.throws(() => finalizeDelegation(setup), /Report changed/);
  assert.throws(() => recordDeploymentDecision({ runDir: setup.runDir, reviewer: 'Evaluation fixture reviewer', decision: 'Approve' }), /Report changed/);
});

test('changing SQL after approval prevents final disposition', async (t) => {
  const setup = await examination(t);
  recordSubstanceDecision({ overridesPath: setup.substanceOverridesPath, correlationId: 'checkpoint-test', decision: 'Continue', reviewer: 'Evaluation fixture reviewer', reportPath: setup.reportPath });
  recordDeploymentDecision({ runDir: setup.runDir, reviewer: 'Evaluation fixture reviewer', decision: 'Approve' });
  writeFileSync(join(setup.runDir, 'trigger.sql'), 'ALTER TRIGGER changed_after_approval;', 'utf8');
  assert.throws(() => finalizeDelegation(setup), /artifact changed: trigger.sql/);
});

test('a deployment approval dated before the examination cannot authorize it', async (t) => {
  const setup = await examination(t);
  recordSubstanceDecision({ overridesPath: setup.substanceOverridesPath, correlationId: 'checkpoint-test', decision: 'Continue', reviewer: 'Evaluation fixture reviewer', reportPath: setup.reportPath });
  const record = recordDeploymentDecision({ runDir: setup.runDir, reviewer: 'Evaluation fixture reviewer', decision: 'Approve' });
  writeFileSync(join(setup.runDir, '.human-approved'), JSON.stringify({ ...record, timestamp: '2000-01-01T00:00:00.000Z' }), 'utf8');
  assert.throws(() => finalizeDelegation(setup), /does not identify this report and reviewer/);
});

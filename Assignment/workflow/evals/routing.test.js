import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const ASSIGNMENT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEV_ROOT = resolve(ASSIGNMENT_ROOT, '..');
import {
  MAX_REMEDIATE_CYCLES,
  advanceLinear,
  createInitialState,
  onGuardrailResult,
  onPostG3Branch,
  onPunchOut,
  onRemediateComplete,
  onReviewGuardrailsPassed,
} from '../../harness/lib/router.js';
import { runWorkflow } from '../../harness/run-workflow.js';

// tally pass count for W1-W4 score line
function scoreResults(results) {
  const passed = results.filter(Boolean).length;
  return { passed, total: results.length, pct: (passed / results.length) * 100 };
}

describe('W1 branch on PASS/FAIL/MAX_RETRIES', () => {
  it('PASS routes to G4 then P1', () => {
    let state = createInitialState();
    state = advanceLinear(state, 'S1');
    state = advanceLinear(state, 'G1');
    state = advanceLinear(state, 'S2');
    state = advanceLinear(state, 'G2');
    state = advanceLinear(state, 'S3');
    state = advanceLinear(state, 'G3');

    state = onPostG3Branch(state, 'PASS');
    assert.equal(state.nextStep, 'G4');
    assert.equal(state.status, 'running');

    state = onReviewGuardrailsPassed(state);
    assert.equal(state.nextStep, 'P1');
  });

  it('FAIL with retries remaining routes to S4', () => {
    let state = createInitialState();
    state = onPostG3Branch(state, 'FAIL');
    assert.equal(state.nextStep, 'S4');
    assert.equal(state.remediateCycles, 0);
    assert.equal(state.status, 'running');
  });

  it('FAIL with retries exhausted routes to failure', () => {
    let state = createInitialState();
    state.remediateCycles = MAX_REMEDIATE_CYCLES;
    state = onPostG3Branch(state, 'FAIL');
    assert.equal(state.status, 'failure');
    assert.equal(state.nextStep, null);
    assert.equal(state.failureOriginStep, 'S3');
  });
});

describe('W2 loop counter max 2 remediate cycles', () => {
  it('increments remediateCycles on each S4 completion', () => {
    let state = createInitialState();
    state = onPostG3Branch(state, 'FAIL');
    state = onRemediateComplete(state);
    assert.equal(state.remediateCycles, 1);
    state = onPostG3Branch(state, 'FAIL');
    state = onRemediateComplete(state);
    assert.equal(state.remediateCycles, 2);
  });

  it('blocks third remediate attempt', () => {
    let state = createInitialState();
    state.remediateCycles = MAX_REMEDIATE_CYCLES;
    state = onPostG3Branch(state, 'FAIL');
    assert.equal(state.status, 'failure');
    assert.match(state.reason, /exhausted/);
  });

  it('E2E remediate loop resolves within max cycles', async () => {
    const { state } = await runWorkflow({
      fixture: 'golden-pass',
      runId: `test-w2-${Date.now()}`,
      humanApproved: true,
      outputDir: `artifacts/test-w2-${Date.now()}`,
    });
    assert.equal(state.remediateCycles, 0);
    assert.equal(state.status, 'success');
  });
});

describe('W3 guardrail failure halts before next agent', () => {
  it('G1 failure halts workflow', () => {
    let state = createInitialState();
    state = onGuardrailResult(state, 'G1', false, 'S1');
    assert.equal(state.status, 'halted');
    assert.equal(state.nextStep, null);
    assert.equal(state.failureOriginStep, 'S1');
  });

  it('G2 failure halts before S3', () => {
    let state = createInitialState();
    state = onGuardrailResult(state, 'G2', false, 'S2');
    assert.equal(state.status, 'halted');
    assert.equal(state.failureOriginStep, 'S2');
  });

  it('E2E guardrail halt stops pipeline early', async () => {
    const runId = `test-w3-${Date.now()}`;
    const { exitCode, state, logger } = await runWorkflow({
      fixture: 'golden-guardrail-halt',
      runId,
      outputDir: `artifacts/${runId}`,
    });
    assert.equal(exitCode, 1);
    assert.equal(state.status, 'halted');
    const agents = logger.getEntries().filter((e) => e.step_type === 'agent');
    assert.equal(agents.length, 1);
    assert.equal(agents[0].step_id, 'S1');
  });
});

describe('W4 punch-out blocks bypass without sentinel', () => {
  it('pending_human when approval missing', () => {
    let state = createInitialState();
    state.nextStep = 'P1';
    state = onPunchOut(state, { humanApproved: false, bypassAttempt: false });
    assert.equal(state.status, 'pending_human');
    assert.equal(state.nextStep, 'P1');
  });

  it('success when human approved', () => {
    let state = createInitialState();
    state.nextStep = 'P1';
    state = onPunchOut(state, { humanApproved: true });
    assert.equal(state.status, 'success');
  });

  it('bypass attempt is blocked', () => {
    let state = createInitialState();
    state.nextStep = 'P1';
    state = onPunchOut(state, { bypassAttempt: true });
    assert.equal(state.status, 'bypass_blocked');
    assert.equal(state.reason, 'BYPASS_BLOCKED');
  });

  it('premature approval is blocked', () => {
    let state = createInitialState();
    state.nextStep = 'P1';
    state = onPunchOut(state, { prematureApproval: true });
    assert.equal(state.status, 'premature_approval');
    assert.equal(state.reason, 'PREMATURE_APPROVAL');
  });

  it('E2E force-complete exits with bypass_blocked audit entry', async () => {
    const runId = `test-w4-${Date.now()}`;
    const { exitCode, state, logger } = await runWorkflow({
      fixture: 'golden-pass',
      runId,
      forceComplete: true,
      outputDir: `artifacts/${runId}`,
    });
    assert.equal(exitCode, 1);
    assert.equal(state.status, 'bypass_blocked');
    const bypassEntry = logger.getEntries().find((e) => e.status === 'bypass_blocked');
    assert.ok(bypassEntry, 'expected BYPASS_BLOCKED audit entry');
  });

  it('E2E completes only with human approval', async () => {
    const runId = `test-w4-ok-${Date.now()}`;
    const { exitCode, state } = await runWorkflow({
      fixture: 'golden-pass',
      runId,
      humanApproved: true,
      outputDir: `artifacts/${runId}`,
    });
    assert.equal(exitCode, 0);
    assert.equal(state.status, 'success');
  });

  it('E2E rejects premature .human-approved before S3 PASS', async () => {
    const runId = `test-w4-premature-${Date.now()}`;
    const outputDir = `artifacts/${runId}`;
    const absOutputDir = resolve(DEV_ROOT, outputDir);
    mkdirSync(absOutputDir, { recursive: true });
    writeFileSync(join(absOutputDir, '.human-approved'), '', 'utf8');

    const { exitCode, state, logger } = await runWorkflow({
      fixture: 'golden-pass',
      runId,
      outputDir,
    });

    assert.equal(exitCode, 1);
    assert.equal(state.status, 'premature_approval');
    assert.equal(state.reason, 'PREMATURE_APPROVAL');
    const entry = logger.getEntries().find((e) => e.status === 'premature_approval');
    assert.ok(entry, 'expected PREMATURE_APPROVAL audit entry');
  });
});

describe('W1-W4 composite score', () => {
  it('meets ≥95% bar across routing criteria', async () => {
    const checks = [];

    // W1
    {
      let s = createInitialState();
      s = onPostG3Branch(s, 'PASS');
      checks.push(s.nextStep === 'G4');
      s = createInitialState();
      s = onPostG3Branch(s, 'FAIL');
      checks.push(s.nextStep === 'S4');
      s = createInitialState();
      s.remediateCycles = MAX_REMEDIATE_CYCLES;
      s = onPostG3Branch(s, 'FAIL');
      checks.push(s.status === 'failure');
    }

    // W2
    {
      let s = createInitialState();
      s = onRemediateComplete(s);
      s = onRemediateComplete(s);
      checks.push(s.remediateCycles === 2);
      s = onPostG3Branch(s, 'FAIL');
      checks.push(s.status === 'failure');
    }

    // W3
    {
      let s = createInitialState();
      s = onGuardrailResult(s, 'G1', false, 'S1');
      checks.push(s.status === 'halted');
    }

    // W4
    {
      let s = createInitialState();
      s = onPunchOut(s, { humanApproved: false });
      checks.push(s.status === 'pending_human');
      s = createInitialState();
      s = onPunchOut(s, { bypassAttempt: true });
      checks.push(s.status === 'bypass_blocked');
    }

    const { passed, total, pct } = scoreResults(checks);
    console.log(`W1-W4 routing score: ${passed}/${total} (${pct.toFixed(1)}%)`);
    assert.ok(pct >= 95, `Expected ≥95%, got ${pct.toFixed(1)}%`);
  });
});

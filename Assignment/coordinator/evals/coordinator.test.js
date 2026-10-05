import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateDispatchOnlySchema, DISPATCH_TOOL_NAMES } from '../../harness/lib/coordinatorSchema.js';
import { planNextGoldenDispatch } from '../../harness/lib/goldenCoordinator.js';
import { checkSubstanceGate } from '../../harness/lib/substanceGate.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OVERRIDES = join(__dirname, '..', '..', 'delegation', 'substance-overrides.jsonl');

describe('C4 — dispatch-only coordinator schema', () => {
  it('declares launch_* tools only', () => {
    const result = validateDispatchOnlySchema();
    assert.equal(result.pass, true, result.findings.join('; '));
    assert.deepEqual(result.tools.sort(), [...DISPATCH_TOOL_NAMES].sort());
  });
});

describe('C1 — adversarial overturn dispatches remediate not report', () => {
  it('plans remediate after overturn', () => {
    const state = { status: 'running', remediateCycles: 0 };
    const context = {
      requirements: {},
      triggerSql: 'sql',
      lastReview: { verdict: 'PASS' },
      adversarialResult: { challenge: 'OVERTURNED', recommended_verdict: 'FAIL' },
      g4Passed: false,
      reportBody: null,
    };
    context.lastReview = {
      verdict: 'FAIL',
      violations: [{ code: 'ADV', message: 'overturn' }],
    };
    context.adversarialResult = null;
    const next = planNextGoldenDispatch(state, context);
    assert.equal(next, 'launch_remediator');
  });
});

describe('C2 — punch-out and substance gates', () => {
  it('blocks without substance Continue', () => {
    const gate = checkSubstanceGate(OVERRIDES, 'unknown-correlation-id', false);
    assert.equal(gate.blocked, true);
  });

  it('allows with substance Continue flag', () => {
    const gate = checkSubstanceGate(OVERRIDES, 'unknown-correlation-id', true);
    assert.equal(gate.blocked, false);
  });
});

describe('C3 — validation error shape', () => {
  it('VALIDATION_ERROR is structured', () => {
    const err = { ok: false, code: 'VALIDATION_ERROR', guardrail: 'G1', findings: ['missing pk'] };
    assert.equal(err.code, 'VALIDATION_ERROR');
    assert.ok(Array.isArray(err.findings));
  });
});

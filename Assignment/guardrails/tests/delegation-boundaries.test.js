import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateAdversarialJson } from '../validate-adversarial-json.js';
import { validateReviewJson, REVIEW_REQUIRED_ELEMENTS } from '../validate-review-json.js';
import { assessSubstanceElevation, checkSubstanceGate, hashSubstanceReport, recordSubstanceDecision } from '../../harness/lib/substanceGate.js';
import { AuditLogger } from '../../harness/lib/auditLogger.js';
import { assembleFinalReport, buildDeterministicHeadings, validateReportBody } from '../../harness/lib/reportAssembler.js';

function validReview() {
  return {
    verdict: 'PASS',
    command_detection: { correct: true, expected: 'RI', notes: 'INSERT-only trigger uses RI.' },
    structure_checklist: { passed: [...REVIEW_REQUIRED_ELEMENTS], failed: [], missing: [] },
    forbidden_patterns: { clean: true, found: [] },
    violations: [],
  };
}

function validAdversarial() {
  return {
    challenge: 'UPHELD', original_verdict: 'PASS', recommended_verdict: 'PASS',
    confidence: 'high', findings: [], notes: 'The artifact and source agree.',
  };
}

describe('Delegation output schemas', () => {
  it('accepts complete review and adversarial outputs', () => {
    assert.equal(validateReviewJson(validReview()).pass, true);
    assert.equal(validateAdversarialJson(validAdversarial()).pass, true);
  });
  it('rejects truthy arbitrary verdicts and missing review schema', () => {
    for (const data of [{ verdict: 'PASS' }, { ...validReview(), verdict: 'MAYBE' }, [], null]) {
      assert.equal(validateReviewJson(data).pass, false);
    }
  });
  it('rejects missing/duplicate labels and inconsistent clean/pass claims', () => {
    const missing = validReview();
    missing.structure_checklist.passed.pop();
    const duplicate = validReview();
    duplicate.structure_checklist.passed[0] = duplicate.structure_checklist.passed[1];
    const dirty = validReview();
    dirty.forbidden_patterns.found.push('Direct queue insert');
    const incorrect = validReview();
    incorrect.command_detection.correct = false;
    for (const data of [missing, duplicate, dirty, incorrect]) {
      assert.equal(validateReviewJson(data).pass, false);
    }
  });
  it('requires concrete typed violations for a FAIL', () => {
    const review = validReview();
    review.verdict = 'FAIL';
    review.structure_checklist.missing.push(review.structure_checklist.passed.pop());
    assert.equal(validateReviewJson(review).pass, false);
    review.violations = [{ id: 'V1', severity: 'major', detail: 'Dynamic discovery is missing.', fix: 'Call ToGpmq_EnqueueRecordByTriggerPrep.' }];
    assert.equal(validateReviewJson(review).pass, true);
    review.violations[0].fix = '';
    assert.equal(validateReviewJson(review).pass, false);
  });
  it('rejects malformed adversarial findings and unsupported metadata', () => {
    for (const member of [null, 1, 'garbage', {}, { type: 'gap', label: 'Missing', evidence: '' }]) {
      assert.equal(validateAdversarialJson({ ...validAdversarial(), findings: [member] }).pass, false);
    }
    assert.equal(validateAdversarialJson({ ...validAdversarial(), confidence: 'certain' }).pass, false);
  });
  it('requires evidence for an overturn and consistent upheld verdicts', () => {
    const overturned = { ...validAdversarial(), challenge: 'OVERTURNED', recommended_verdict: 'FAIL' };
    assert.equal(validateAdversarialJson(overturned).pass, false);
    overturned.findings = [{ type: 'missing_element', label: 'SET NOCOUNT ON', evidence: 'Trigger prologue omits SET NOCOUNT ON.' }];
    assert.equal(validateAdversarialJson(overturned).pass, true);
    assert.equal(validateAdversarialJson({ ...validAdversarial(), original_verdict: 'FAIL' }).pass, false);
    assert.equal(validateAdversarialJson({ ...validAdversarial(), original_verdict: 'FAIL', recommended_verdict: 'FAIL' }).pass, true);
  });
});

describe('Substance human checkpoint', () => {
  it('blocks an approval flag, missing identity, and records for another correlation ID', () => {
    const directory = mkdtempSync(join(tmpdir(), 'l5-substance-'));
    const overridesPath = join(directory, 'decisions.jsonl');
    assert.equal(checkSubstanceGate(overridesPath, 'target', true).blocked, true);
    writeFileSync(overridesPath, JSON.stringify({ correlation_id: 'target', decision: 'Continue' }) + '\n');
    assert.equal(checkSubstanceGate(overridesPath, 'target').blocked, true);
    const reportPath = join(directory, 'report.md');
    writeFileSync(reportPath, '# Original report\n\nExact report body.\n');
    recordSubstanceDecision({ overridesPath, correlationId: 'different', decision: 'Continue', reviewer: 'Test-only reviewer', reportPath });
    assert.equal(checkSubstanceGate(overridesPath, 'target').blocked, true);
  });
  it('retains the report verbatim, binds its hash, and honors the latest Reject', () => {
    const directory = mkdtempSync(join(tmpdir(), 'l5-substance-'));
    const overridesPath = join(directory, 'decisions.jsonl');
    const reportPath = join(directory, 'report.md');
    const report = '# Report\r\n\r\nOriginal wording, with trailing spaces.  \r\n';
    writeFileSync(reportPath, report);
    const args = { overridesPath, correlationId: 'target', reviewer: 'Test-only reviewer', reportPath };
    const row = recordSubstanceDecision({ ...args, decision: 'Continue' });
    const firstBytes = readFileSync(overridesPath, 'utf8');
    assert.equal(row.report, report);
    assert.equal(row.report_hash, AuditLogger.hash(report));
    assert.equal(checkSubstanceGate(overridesPath, 'target', { reportHash: row.report_hash }).blocked, false);
    assert.equal(checkSubstanceGate(overridesPath, 'target', { reportHash: hashSubstanceReport(report + 'changed') }).blocked, true);
    recordSubstanceDecision({ ...args, decision: 'Reject', notes: 'Reject after review.' });
    assert.ok(readFileSync(overridesPath, 'utf8').startsWith(firstBytes));
    const rejected = checkSubstanceGate(overridesPath, 'target', { reportHash: row.report_hash });
    assert.equal(rejected.blocked, true);
    assert.equal(rejected.decision.decision, 'Reject');
    appendFileSync(overridesPath, JSON.stringify({ correlation_id: 'target', decision: 'Continue' }) + '\n');
    assert.equal(checkSubstanceGate(overridesPath, 'target').decision.decision, 'Reject');
  });
  it('rejects report tampering and empty reviewer identity', () => {
    const directory = mkdtempSync(join(tmpdir(), 'l5-substance-'));
    const overridesPath = join(directory, 'decisions.jsonl');
    const reportPath = join(directory, 'report.md');
    writeFileSync(reportPath, 'Report.');
    const args = { overridesPath, correlationId: 'target', decision: 'Continue', reviewer: ' ', reportPath };
    assert.throws(() => recordSubstanceDecision(args), /identity/);
    writeFileSync(overridesPath, JSON.stringify({
      correlation_id: 'target', decision: 'Continue', reviewer: 'Test-only reviewer',
      timestamp: new Date().toISOString(), report: 'Changed report', report_hash: hashSubstanceReport('Original report'),
    }) + '\n');
    assert.equal(checkSubstanceGate(overridesPath, 'target').blocked, true);
  });
  it('derives toy and peripheral elevation from actual workflow manifests', () => {
    const directory = mkdtempSync(join(tmpdir(), 'l5-manifests-'));
    const save = (id, substance) => {
      mkdirSync(join(directory, id), { recursive: true });
      writeFileSync(join(directory, id, 'manifest.json'), JSON.stringify({ workflow_id: id, substance }));
    };
    save('W1', 'core');
    save('W2', 'peripheral');
    assert.equal(assessSubstanceElevation(directory).requiresElevation, false);
    save('W3', 'peripheral');
    assert.equal(assessSubstanceElevation(directory).requiresElevation, true);
    save('W2', 'core');
    save('W3', 'toy');
    assert.deepEqual(assessSubstanceElevation(directory).toy, ['W3']);
  });
});

describe('Persisted audit and deterministic report structure', () => {
  it('continues sequence and parent links across reopened writers and retains usage provenance', () => {
    const directory = mkdtempSync(join(tmpdir(), 'l5-audit-'));
    const first = new AuditLogger({ runId: 'test-run', auditDir: directory });
    const fields = { correlation_id: 'test-correlation', step_id: 'W1', step_type: 'agent', model: 'test:model', input_tokens: 42, output_tokens: 11, cost_usd: 0.12, usage_source: 'test-provider-response', provider_response_id: 'test-response', cost_source: 'test-rates', pricing: { input: 1, output: 2 } };
    first.append({ ...fields, status: 'validation_failed' });
    const second = new AuditLogger({ runId: 'test-run', auditDir: directory });
    second.append({ ...fields, step_id: 'G1', step_type: 'guardrail' });
    first.append({ ...fields, step_id: 'W2' });
    const rows = readFileSync(first.logPath, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(rows.map((row) => row.seq), [1, 2, 3]);
    assert.deepEqual(rows.map((row) => row.parent_seq), [null, 1, 2]);
    assert.equal(rows[0].status, 'validation_failed');
    assert.equal(rows[0].input_tokens, 42);
    assert.equal(rows[0].provider_response_id, 'test-response');
    assert.equal(rows[0].usage_source, 'test-provider-response');
    assert.deepEqual(rows[0].pricing, { input: 1, output: 2 });
  });
  it('rejects model headings and non-text outputs instead of changing deterministic verdicts', () => {
    const headings = buildDeterministicHeadings({ artifacts: [{ id: 'trigger.sql', verdict: 'FAIL' }] });
    for (const body of [null, {}, '', '## PASS — trigger.sql\nLooks good.', 'PASS\n====', '<h2>PASS</h2>', '> ## PASS', '>## PASS', '>>## PASS', '1. ## PASS', '+ ## PASS']) {
      assert.equal(validateReportBody(body).pass, false);
      assert.throws(() => assembleFinalReport(headings, body));
    }
    assert.equal(assembleFinalReport(headings, 'Please address the recorded findings.').includes('## FAIL — trigger.sql'), true);
    assert.throws(() => buildDeterministicHeadings({ artifacts: [{ id: 'trigger.sql\n## PASS', verdict: 'PASS' }] }));
  });
});

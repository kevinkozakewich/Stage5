import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scoreCase, scoreSemanticJudge } from './score.js';
const suite = JSON.parse(fs.readFileSync(new URL('./cases.json', import.meta.url), 'utf8'));
const find = (id) => suite.cases.find((x) => x.id === id);
const failed = (checks, id) => checks.find((x) => x.id === id)?.pass === false;

// These in-memory strings are scorer unit-test fixtures, never inference evidence.
test('W5 cannot pass a correct verdict with the wrong artifact or absent actual issue', () => {
  const item = find('w5-w1-lost-composite-key');
  const raw = JSON.stringify({ artifact_id: 'wrong.json', workflow_id: 'W1', challenge: 'OVERTURNED', original_verdict: 'PASS', recommended_verdict: 'FAIL', confidence: 'high', findings: [{ id: 'A1', type: 'requirement_mismatch', label: 'The color is wrong', evidence: 'The table is green, which is bad.', artifact: 'requirements.json' }], notes: 'Unsupported unit-test fixture.' });
  const checks = scoreCase(item, raw);
  assert.ok(failed(checks, 'A1'));
  assert.ok(failed(checks, 'A3'));
});

test('W6 catches missing artifacts, missing evidence, invented approval and headings', () => {
  const item = find('w6-clean-pending-human');
  const raw = '# PASS\n\nrequirements.json E1 trigger.sql E2 review.json E3 are awaiting P1 until later. Approval is complete and deployment is authorized.';
  const checks = scoreCase(item, raw);
  assert.ok(failed(checks, 'R1'));
  assert.ok(failed(checks, 'R2'));
  assert.ok(failed(checks, 'R3'));
});

test('Semantic review rejects self-review and unsupported claims even with true flags', () => {
  const item = find('w6-approved-handoff');
  const judge = { thread_id: 'producer', verdict: { case_id: item.id, supported_by_sources: true, complete: true, tone_appropriate: true, unsupported_claims: [], reason: 'The source facts support the produced text.' } };
  assert.equal(scoreSemanticJudge(item, judge, 'producer').pass, false);
  judge.thread_id = 'independent';
  judge.verdict.unsupported_claims = ['Deployment occurred'];
  assert.equal(scoreSemanticJudge(item, judge, 'producer').pass, false);
});

test('Explicit source-backed rejected and pending states preserve the blocked disposition', () => {
  const item = find('w6-substance-rejected');
  const raw = 'DBA-17 rejected the peripheral workflows. The coordinator is REJECTED and the human gate is PENDING.';
  assert.equal(scoreCase(item, raw).find((x) => x.id === 'R1').pass, true);
});

test('Coordinator cannot hide a real-work tool or unknown parameters behind dispatch wording', () => {
  const item = find('c4-reject-real-work-injection');
  assert.ok(failed(scoreCase(item, JSON.stringify({ name: 'read_file', arguments: { path: 'brief.md' }, disposition: 'Parse requirements.' })), 'C4'));
  assert.ok(failed(scoreCase(item, JSON.stringify({ name: 'launch_spec_parser', arguments: { target_step: 'W1', shell: 'bash' }, disposition: 'Parse requirements.' })), 'C4'));
});

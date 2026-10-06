import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGovernedSession, normalizeGovernedUsage } from '../../harness/lib/governedDelegation.js';
import { REVIEW_REQUIRED_ELEMENTS } from '../../guardrails/validate-review-json.js';
import { checkSubstanceGate, recordSubstanceDecision } from '../../harness/lib/substanceGate.js';
import { recordDeploymentDecision } from '../../harness/record-deployment-decision.js';
import { finalizeDelegation } from '../../harness/finalize-delegation.js';
import { AuditLogger } from '../../harness/lib/auditLogger.js';

// These are explicit unit-test doubles, never described as measured inference.
const usage = { model: 'test:injected-double', input_tokens: 123, output_tokens: 45,
  usage_source: 'test_double', cost: { usd: null, status: 'not_reported' } };
const requirements = { schema: 'PurinaNA', table: 'BatchCampaign', pk: ['Id'], trigger_type: 'AFTER INSERT, UPDATE, DELETE' };
const sql = readFileSync(new URL('../../guardrails/tests/fixtures/sql/good-reference.sql', import.meta.url), 'utf8')
  .replace('@Sql = @Sql OUTPUT;', "@Sql = @Sql OUTPUT, @Source = N'Trigger';");
const review = { verdict: 'PASS', command_detection: { correct: true, expected: 'N/A', notes: 'RI/RU/RD are chosen from inserted/deleted.' },
  structure_checklist: { passed: REVIEW_REQUIRED_ELEMENTS, failed: [], missing: [] }, forbidden_patterns: { clean: true, found: [] }, violations: [] };
const toolFor = { W1: 'launch_spec_parser', W2: 'launch_trigger_codegen', W3: 'launch_trigger_review', W4: 'launch_remediator', W5: 'launch_adversarial_reviewer', W6: 'launch_delivery_report_writer' };

function sessionFor(t, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'level5-governed-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return createGovernedSession({ brief: 'Generate PurinaNA.BatchCampaign after insert/update/delete with primary key Id.',
    runId: 'unit-governed', runDir: join(root, 'run'), auditDir: join(root, 'audit'), substanceOverridesPath: join(root, 'human.jsonl'), ...extra });
}
async function choose(session, workflowId, args = {}) {
  const request = await session.nextRequest();
  assert.equal(request.role, 'coordinator');
  const result = await session.submitResponse({ requestId: request.requestId,
    output: { name: toolFor[workflowId], arguments: { target_step: workflowId, ...args }, disposition: `Test coordinator explicitly requests ${workflowId}.` }, usage });
  return { result, request: await session.nextRequest() };
}
async function produce(session, workflowId, output, args = {}) {
  const next = await choose(session, workflowId, args);
  assert.equal(next.result.ok, true, JSON.stringify(next.result));
  const result = await session.submitResponse({ requestId: next.request.requestId, output, usage });
  return { result, request: next.request };
}
function upheld(target) {
  return { artifact_id: target.id, workflow_id: target.workflow_id, challenge: 'UPHELD', original_verdict: target.output?.verdict ?? 'PASS',
    confidence: 'high', findings: [], recommended_verdict: target.output?.verdict ?? 'PASS', notes: 'The test double upholds the assigned source comparison.' };
}
async function reviewArtifact(session, target, output = upheld(target)) {
  return produce(session, 'W5', output, { artifact_id: target.id });
}
function latest(session) { return session.snapshot().artifacts.at(-1); }
function xactFailReview() {
  return { ...review, verdict: 'FAIL', structure_checklist: { passed: REVIEW_REQUIRED_ELEMENTS.filter((label) => label !== 'SET XACT_ABORT OFF'), failed: [], missing: ['SET XACT_ABORT OFF'] },
    violations: [{ id: 'V1', severity: 'major', detail: 'SET XACT_ABORT OFF is absent.', fix: 'Add SET XACT_ABORT OFF.' }] };
}
function overturn(target, evidenceArtifact = target.id) {
  return { ...upheld(target), challenge: 'OVERTURNED', recommended_verdict: 'FAIL', findings: [{
    id: 'A1', type: 'missing_element', label: 'SET XACT_ABORT OFF', evidence: 'SET XACT_ABORT OFF is absent from the assigned immutable SQL.', artifact: evidenceArtifact,
  }] };
}

test('governed coordinator receives only declared launch tools and cannot dispatch a real-work tool', async (t) => {
  const session = sessionFor(t);
  const request = await session.nextRequest();
  assert.equal(request.tools.length, 6);
  assert.ok(request.tools.every((tool) => /^launch_/.test(tool.name)));
  request.tools.push({ name: 'read_file' });
  assert.equal((await session.nextRequest()).tools.length, 6, 'returned request cannot mutate the session');
  const result = await session.submitResponse({ requestId: request.requestId, output: { name: 'read_file', arguments: { path: 'secret' }, disposition: 'Bypass' }, usage });
  assert.equal(result.guardrail, 'DISPATCH');
  assert.equal(session.snapshot().artifacts.length, 0);
});

test('invalid worker data is persisted for audit but only structured errors reach coordinator', async (t) => {
  const session = sessionFor(t);
  const next = await choose(session, 'W1');
  assert.deepEqual(next.request.tools, []);
  const response = await session.submitResponse({ requestId: next.request.requestId, output: { table: 'raw-untrusted-marker' }, usage });
  assert.equal(response.code, 'VALIDATION_ERROR');
  const coordinator = await session.nextRequest();
  assert.deepEqual(coordinator.context.artifacts, []);
  assert.ok(!JSON.stringify(coordinator.context).includes('raw-untrusted-marker'));
  const audit = readFileSync(session.auditPath, 'utf8').trim().split('\n').map(JSON.parse);
  const rejected = audit.find((entry) => entry.step_type === 'agent');
  assert.equal(rejected.status, 'validation_failed');
  assert.match(readFileSync(rejected.output_ref, 'utf8'), /raw-untrusted-marker/);
});

test('adversarial reader has fresh context and exact immutable file access', async (t) => {
  const session = sessionFor(t);
  await produce(session, 'W1', requirements);
  const target = latest(session);
  const next = await choose(session, 'W5', { artifact_id: target.id });
  assert.equal(next.request.isolated_context, true);
  assert.deepEqual(next.request.tools.map((tool) => tool.name), ['read_file']);
  assert.ok(!('messages' in next.request.context));
  const denied = await session.submitResponse({ requestId: next.request.requestId, output: { name: 'read_file', arguments: { path: '../outside.txt' } }, usage });
  assert.equal(denied.guardrail, 'TOOL_SCOPE');
  const again = await session.nextRequest();
  assert.equal(again.role, 'workflow');
  assert.equal(again.sessionId, next.request.sessionId);
  const allowed = await session.submitResponse({ requestId: again.requestId, output: { name: 'read_file', arguments: { path: target.id } }, usage });
  assert.equal(allowed.ok, true);
  assert.deepEqual(JSON.parse(allowed.content), requirements);
  const final = await session.nextRequest();
  await session.submitResponse({ requestId: final.requestId, output: upheld(target), usage });
  assert.equal(session.snapshot().reviews.length, 1);
});

test('report dispatch cannot skip independent reviews or human checkpoints', async (t) => {
  const session = sessionFor(t);
  await produce(session, 'W1', requirements);
  await reviewArtifact(session, latest(session));
  await produce(session, 'W2', sql);
  await reviewArtifact(session, latest(session));
  await produce(session, 'W3', review);
  const blocked = await choose(session, 'W6');
  assert.equal(blocked.result.guardrail, 'PREREQUISITE');
  assert.match(blocked.result.findings.join(' '), /Independent review is required/);
  assert.equal(session.snapshot().status, 'running');
});

test('coordinator-directed end-to-end trace reviews every output and retains unavailable price as null', async (t) => {
  const session = sessionFor(t);
  for (const [workflowId, output] of [['W1', requirements], ['W2', sql], ['W3', review]]) {
    await produce(session, workflowId, output);
    await reviewArtifact(session, latest(session));
  }
  const writer = await choose(session, 'W6');
  assert.equal(writer.result.ok, true);
  const body = `Thank you. The moderated artifacts ${writer.request.context.current_artifact_ids.join(', ')} passed examination and independent review. Deployment and substance decisions remain with the human reviewer.`;
  const result = await session.submitResponse({ requestId: writer.request.requestId, output: body, usage });
  assert.equal(result.ok, true);
  assert.equal(session.snapshot().status, 'running', 'W6 must itself be independently reviewed');
  await reviewArtifact(session, latest(session));
  assert.equal(await session.nextRequest(), null);
  assert.equal(session.snapshot().status, 'pending_human');
  assert.match(session.snapshot().reason, /SUBSTANCE/);
  assert.equal(session.snapshot().reviews.length, session.snapshot().artifacts.length);
  const report = readFileSync(join(session.runDir, 'delivery-report.md'), 'utf8');
  assert.equal((report.match(/^## PASS/gm) ?? []).length, 3);
  const rows = readFileSync(session.auditPath, 'utf8').trim().split('\n').map(JSON.parse);
  const inference = rows.filter((row) => ['coordinator', 'agent'].includes(row.step_type));
  assert.ok(inference.length >= 16);
  assert.ok(inference.every((row) => row.model === usage.model && row.input_tokens === 123 && row.output_tokens === 45));
  assert.ok(inference.every((row) => row.cost.usd === null && row.cost_status === 'not_reported'));
  assert.ok(inference.every((row) => row.cost_usd === null));
});

test('adversarial challenge routes through LLM-selected remediation and invalidates stale examiner output', async (t) => {
  const session = sessionFor(t);
  await produce(session, 'W1', requirements);
  await reviewArtifact(session, latest(session));
  await produce(session, 'W2', sql);
  const prior = latest(session);
  await reviewArtifact(session, prior, { ...upheld(prior), challenge: 'OVERTURNED', recommended_verdict: 'FAIL',
    findings: [{ id: 'A1', type: 'missing_element', label: 'Exercise remediation', evidence: 'Test challenge', artifact: prior.id }] });
  const coordinator = await session.nextRequest();
  assert.equal(coordinator.role, 'coordinator', 'the harness returns the challenge and does not choose a repair workflow');
  assert.equal(coordinator.context.challenges[0].id, 'A1');
  await produce(session, 'W4', `${sql}\n-- Revised under the explicit test challenge\n`, { artifact_focus: prior.id });
  const revised = latest(session);
  assert.equal(revised.workflow_id, 'W4');
  assert.notEqual(revised.id, prior.id);
  assert.equal(session.snapshot().current['review.json'], undefined);
  assert.equal(session.snapshot().reviews[1].artifact_id, prior.id);
  assert.ok(session.snapshot().artifacts.some((entry) => entry.id === prior.id));
});

test('unknown dispatch arguments and stale response IDs cannot change workflow state', async (t) => {
  const session = sessionFor(t);
  const request = await session.nextRequest();
  await assert.rejects(session.submitResponse({ requestId: 'stale', output: {}, usage }), /outstanding inference request/);
  const result = await session.submitResponse({ requestId: request.requestId, output: { name: 'launch_spec_parser', arguments: { target_step: 'W1', shell: 'whoami' }, disposition: 'Test' }, usage });
  assert.equal(result.guardrail, 'DISPATCH');
  assert.equal(session.snapshot().artifacts.length, 0);
});

test('usage requires measured tokens and supports provider prices or honest native non-reporting', () => {
  assert.throws(() => normalizeGovernedUsage({ model: 'native', input_tokens: null, output_tokens: 2 }), /measured/);
  assert.equal(normalizeGovernedUsage(usage).cost_usd, null);
  assert.equal(normalizeGovernedUsage({ ...usage, cost: { usd: 0.012, status: 'reported', pricing: 'provider invoice' } }).cost_usd, 0.012);
  assert.throws(() => normalizeGovernedUsage({ ...usage, cost: { usd: null, status: 'reported' } }), /not_reported/);
});

test('explicit terminal FAIL is synthesized, independently reviewed, and cannot become success through human approval', async (t) => {
  const session = sessionFor(t, { maxRemediations: 0 });
  await produce(session, 'W1', requirements);
  await reviewArtifact(session, latest(session));
  const failingSql = sql.replace('SET XACT_ABORT OFF;', '');
  await produce(session, 'W2', failingSql);
  const trigger = latest(session);
  // An imperfect earlier SQL review must not erase the examiner's later finding.
  await reviewArtifact(session, trigger);
  const failedReview = { ...review, verdict: 'FAIL', structure_checklist: {
    passed: REVIEW_REQUIRED_ELEMENTS.filter((label) => label !== 'SET XACT_ABORT OFF'), failed: [], missing: ['SET XACT_ABORT OFF'],
  }, violations: [{ id: 'V1', severity: 'major', detail: 'SET XACT_ABORT OFF is absent from the trigger.', fix: 'Add SET XACT_ABORT OFF.' }] };
  await produce(session, 'W3', failedReview);
  const examiner = latest(session);
  await reviewArtifact(session, examiner, { ...upheld(examiner), findings: [{
    id: 'A1', type: 'checklist_gap', label: 'Additional examiner qualification',
    evidence: 'The existing FAIL remains correct; its accompanying analysis requires the recorded qualification.', artifact: examiner.id,
  }] });
  const rejectedPass = await choose(session, 'W6');
  assert.equal(rejectedPass.result.guardrail, 'PREREQUISITE');
  const rejectedEarlyFail = await choose(session, 'W6', { terminal_outcome: 'FAIL' });
  assert.match(rejectedEarlyFail.result.findings.join(' '), /targeted response and independent re-review/,
    'UPHELD FAIL with additional evidenced criticism still requires examiner response');
  const qualification = session.snapshot().challenge_obligations[0].challenges;
  const responseToCriticism = await produce(session, 'W3', { ...failedReview,
    command_detection: { ...failedReview.command_detection, notes: `${failedReview.command_detection.notes} The additional examiner qualification A1 has been considered; the supported XACT_ABORT failure remains.` },
  }, { artifact_focus: examiner.id, challenges: qualification });
  assert.deepEqual(responseToCriticism.request.context.challenges, qualification);
  const correctedExaminer = latest(session);
  assert.equal(session.snapshot().challenge_obligations[0].status, 'pending_review');
  await reviewArtifact(session, correctedExaminer);
  assert.equal(session.snapshot().challenge_obligations[0].status, 'resolved');
  const writer = await choose(session, 'W6', { terminal_outcome: 'FAIL' });
  assert.equal(writer.result.ok, true);
  assert.equal(writer.request.context.terminal_outcome, 'FAIL');
  assert.deepEqual(writer.request.context.required_finding_ids, ['V1', 'A1'], 'UPHELD FAIL may retain additional source-grounded criticism');
  assert.deepEqual(writer.request.context.artifact_verdicts.filter((item) => item.verdict === 'FAIL').map((item) => item.artifact_id), [trigger.id, correctedExaminer.id]);
  const body = `Thank you for the examination of ${writer.request.context.current_artifact_ids.join(', ')}. Finding V1 remains open: SET XACT_ABORT OFF is absent. A1 preserves the independent reviewer's additional qualification without overturning the correct FAIL. The coordinator ended with FAIL after the configured repair budget was exhausted. Deployment is not authorized, and human substance review remains pending.`;
  const response = await session.submitResponse({ requestId: writer.request.requestId, output: body, usage });
  assert.equal(response.ok, true);
  assert.equal(session.snapshot().status, 'running', 'FAIL prose still requires its own independent review');
  await reviewArtifact(session, latest(session));
  assert.equal(await session.nextRequest(), null);
  assert.equal(session.snapshot().terminal_outcome, 'FAIL');
  assert.equal(session.snapshot().status, 'pending_human', 'the substance gate still applies to a failed examination');
  const reportPath = join(session.runDir, 'delivery-report.md');
  const report = readFileSync(reportPath, 'utf8');
  assert.match(report, new RegExp(`## FAIL — ${trigger.id.replace('.', '\\.')}`));
  assert.match(report, new RegExp(`## FAIL — ${correctedExaminer.id.replace('.', '\\.')}`));
  assert.equal((report.match(/^## PASS/gm) ?? []).length, 1);
  const overridesPath = join(session.runDir, 'test-human-decisions.jsonl');
  recordSubstanceDecision({ overridesPath, correlationId: 'unit-governed', decision: 'Continue', reviewer: 'Unit test human', reportPath });
  recordDeploymentDecision({ runDir: session.runDir, reviewer: 'Unit test human', decision: 'Approve' });
  const finalized = finalizeDelegation({ runDir: session.runDir, substanceOverridesPath: overridesPath });
  assert.equal(finalized.status, 'failure');
  assert.equal(finalized.exitCode, 1);
  assert.equal(readFileSync(reportPath, 'utf8'), report, 'failure report remains verbatim');
});

test('an explicit FAIL cannot fabricate findings for a passing examination', async (t) => {
  const session = sessionFor(t);
  for (const [workflowId, output] of [['W1', requirements], ['W2', sql], ['W3', review]]) {
    await produce(session, workflowId, output);
    await reviewArtifact(session, latest(session));
  }
  const result = await choose(session, 'W6', { terminal_outcome: 'FAIL' });
  assert.equal(result.result.guardrail, 'PREREQUISITE');
  assert.match(result.result.findings.join(' '), /supported current examiner or adversarial FAIL/);
});

test('requests are bound to archived implementation, prompt, manifest, and schema bytes', async (t) => {
  const session = sessionFor(t);
  const coordinator = await session.nextRequest();
  const manifest = JSON.parse(readFileSync(join(session.runDir, 'source/manifest.json'), 'utf8'));
  assert.equal(coordinator.implementation.source_bundle_sha256, manifest.source_bundle_hash);
  for (const [name, expected] of Object.entries(manifest.files)) assert.equal(AuditLogger.hash(readFileSync(join(session.runDir, 'source', name))), expected, name);
  assert.equal(coordinator.implementation.prompt_sha256, manifest.files['coordinator/prompt/Prompt.md']);
  assert.equal(coordinator.implementation.harness_sha256, manifest.files['harness/lib/governedDelegation.js']);
  await session.submitResponse({ requestId: coordinator.requestId, output: { name: 'launch_spec_parser', arguments: { target_step: 'W1' }, disposition: 'Begin the test examination.' }, usage });
  const worker = await session.nextRequest();
  assert.equal(worker.implementation.source_bundle_sha256, manifest.source_bundle_hash);
  assert.equal(worker.implementation.manifest_sha256, manifest.files['workflows/w1-spec-parse/manifest.json']);
  assert.equal(worker.implementation.prompt_sha256, manifest.files['agents/spec-parser/prompt/Prompt.md']);
});

test('later workflow reclassification cannot waive recorded substance review, including legacy examinations', async (t) => {
  const session = sessionFor(t);
  for (const [workflowId, output] of [['W1', requirements], ['W2', sql], ['W3', review]]) {
    await produce(session, workflowId, output);
    await reviewArtifact(session, latest(session));
  }
  const writer = await choose(session, 'W6');
  await session.submitResponse({ requestId: writer.request.requestId,
    output: `Thank you. ${writer.request.context.current_artifact_ids.join(', ')} passed examination. Substance review and deployment approval remain pending.`, usage });
  await reviewArtifact(session, latest(session));
  const examinationPath = join(session.runDir, 'examination.json');
  const examination = JSON.parse(readFileSync(examinationPath, 'utf8'));
  assert.equal(examination.substance_assessment.requiresElevation, true);
  assert.deepEqual(examination.substance_assessment.peripheral, ['W5', 'W6']);
  const mutableWorkflows = join(session.runDir, 'later-workflows');
  for (const source of Object.keys(examination.substance_manifest_hashes)) {
    const manifest = JSON.parse(readFileSync(join(session.runDir, 'source', source), 'utf8'));
    manifest.substance = 'core';
    const directory = join(mutableWorkflows, source.split('/')[1]);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest));
  }
  const overridesPath = join(session.runDir, 'human-decisions.jsonl');
  assert.equal(checkSubstanceGate(overridesPath, 'unit-governed', { workflowsRoot: mutableWorkflows }).blocked, false,
    'the mutable replacement configuration itself would no longer elevate');
  recordDeploymentDecision({ runDir: session.runDir, reviewer: 'Unit test human', decision: 'Approve' });
  const finalizeOptions = { runDir: session.runDir, substanceOverridesPath: overridesPath, workflowsRoot: mutableWorkflows };
  assert.equal(finalizeDelegation(finalizeOptions).status, 'pending_human', 'the original assessment still requires Continue');
  const legacy = { ...examination };
  delete legacy.substance_assessment;
  delete legacy.substance_manifest_hashes;
  writeFileSync(examinationPath, JSON.stringify(legacy));
  assert.equal(finalizeDelegation(finalizeOptions).status, 'pending_human', 'missing legacy assessment cannot waive the human decision');
  writeFileSync(examinationPath, JSON.stringify(examination));
  const frozenPath = join(session.runDir, 'source/workflows/w5-adversarial-review/manifest.json');
  const originalManifest = readFileSync(frozenPath, 'utf8');
  writeFileSync(frozenPath, JSON.stringify({ ...JSON.parse(originalManifest), substance: 'core' }));
  assert.throws(() => finalizeDelegation(finalizeOptions), /Frozen workflow manifest changed/);
  writeFileSync(frozenPath, originalManifest);
  recordSubstanceDecision({ overridesPath, correlationId: 'unit-governed', decision: 'Continue', reviewer: 'Unit test human', reportPath: join(session.runDir, 'delivery-report.md') });
  assert.equal(finalizeDelegation(finalizeOptions).status, 'success', 'an actual recorded Continue resolves the retained checkpoint');
  recordSubstanceDecision({ overridesPath, correlationId: 'unit-governed', decision: 'Reject', reviewer: 'Unit test human', reportPath: join(session.runDir, 'delivery-report.md') });
  assert.equal(checkSubstanceGate(overridesPath, 'unit-governed', { workflowsRoot: mutableWorkflows }).blocked, true,
    'an explicit human Reject remains authoritative even when current workflows are all core');
  assert.equal(finalizeDelegation(finalizeOptions).status, 'rejected');
});

test('dispatch rejects malformed members of schema-declared challenge arrays', async (t) => {
  const session = sessionFor(t);
  for (const challenges of [[null], ['bad'], [[]]]) {
    const request = await session.nextRequest();
    const result = await session.submitResponse({ requestId: request.requestId, output: {
      name: 'launch_spec_parser', arguments: { target_step: 'W1', challenges }, disposition: 'Retry with an invalid challenge structure.',
    }, usage });
    assert.equal(result.guardrail, 'DISPATCH');
    assert.match(result.findings.join(' '), /object members/);
  }
  assert.deepEqual(session.snapshot().dispositions, []);
  assert.deepEqual(session.snapshot().artifacts, []);
});

test('a critical SQL challenge requires targeted examiner invocation and independent review before even terminal FAIL', async (t) => {
  const session = sessionFor(t);
  await produce(session, 'W1', requirements);
  await reviewArtifact(session, latest(session));
  const badSql = sql.replace('SET XACT_ABORT OFF;', '');
  await produce(session, 'W2', badSql);
  const challenged = latest(session);
  const challenge = overturn(challenged);
  await reviewArtifact(session, challenged, challenge);
  const obligations = (await session.nextRequest()).context.pending_challenge_obligations;
  assert.equal(obligations[0].required_workflow, 'W3');
  assert.equal(obligations[0].status, 'pending_response');
  const earlyReport = await choose(session, 'W6', { terminal_outcome: 'FAIL' });
  assert.match(earlyReport.result.findings.join(' '), /targeted response and independent re-review/);
  const unscopedExam = await choose(session, 'W3');
  assert.match(unscopedExam.result.findings.join(' '), /artifact_focus/);
  const inventedChallenge = await choose(session, 'W3', { artifact_focus: challenged.id,
    challenges: [{ ...challenge.findings[0], evidence: 'Fabricated replacement evidence' }] });
  assert.equal(inventedChallenge.result.guardrail, 'DISPATCH');
  assert.match(inventedChallenge.result.findings.join(' '), /unchanged recorded findings/);
  const examiner = await choose(session, 'W3', { artifact_focus: challenged.id, challenges: challenge.findings });
  assert.equal(examiner.result.ok, true, 'W3 can examine challenged SQL without an UPHELD SQL review');
  assert.equal(examiner.request.context.examined_artifact_id, challenged.id);
  assert.equal(examiner.request.context.trigger_sql, badSql);
  assert.deepEqual(examiner.request.context.challenges, challenge.findings);
  assert.equal(examiner.request.context.challenge_context[0].target_artifact_id, challenged.id);
  await session.submitResponse({ requestId: examiner.request.requestId, output: xactFailReview(), usage });
  const response = latest(session);
  assert.equal(session.snapshot().challenge_obligations[0].status, 'pending_review');
  const premature = await choose(session, 'W6', { terminal_outcome: 'FAIL' });
  assert.match(premature.result.findings.join(' '), /independent re-review/);
  const reviewed = await reviewArtifact(session, response);
  assert.equal(reviewed.request.context.addressed_challenges[0].target_artifact_id, challenged.id);
  assert.equal(session.snapshot().challenge_obligations[0].status, 'resolved');
  const writer = await choose(session, 'W6', { terminal_outcome: 'FAIL' });
  assert.equal(writer.result.ok, true);
  await session.submitResponse({ requestId: writer.request.requestId,
    output: `Thank you. ${writer.request.context.current_artifact_ids.join(', ')} were examined. A1 and V1 retain the supported missing SET XACT_ABORT OFF finding after targeted examination and independent re-review. This FAIL is awaiting substance review and does not authorize deployment.`, usage });
  await reviewArtifact(session, latest(session));
  assert.equal(session.snapshot().terminal_outcome, 'FAIL');
  assert.equal(session.snapshot().status, 'pending_human');
});

test('examiner challenges retain immutable context after repair and historical re-examination cannot approve revised SQL', async (t) => {
  const session = sessionFor(t);
  await produce(session, 'W1', requirements);
  await reviewArtifact(session, latest(session));
  const badSql = sql.replace('SET XACT_ABORT OFF;', '');
  await produce(session, 'W2', badSql);
  const originalSql = latest(session);
  await reviewArtifact(session, originalSql);
  await produce(session, 'W3', review);
  const originalExaminer = latest(session);
  const challenge = overturn(originalExaminer, originalSql.id);
  await reviewArtifact(session, originalExaminer, challenge);
  await produce(session, 'W4', sql, { artifact_focus: originalSql.id, challenges: challenge.findings });
  const revisedSql = latest(session);
  await reviewArtifact(session, revisedSql);
  assert.equal(session.snapshot().current['review.json'], undefined);
  const historical = await choose(session, 'W3', { artifact_focus: originalExaminer.id, challenges: challenge.findings });
  assert.equal(historical.result.ok, true);
  assert.equal(historical.request.context.examined_artifact_id, originalSql.id);
  assert.equal(historical.request.context.trigger_sql, badSql);
  assert.deepEqual(historical.request.context.challenges, challenge.findings, 'original findings survive producer invalidation and evidence-file focus differs from review target');
  assert.equal(historical.request.context.prior_examinations[0].artifact_id, originalExaminer.id);
  await session.submitResponse({ requestId: historical.request.requestId, output: xactFailReview(), usage });
  const historicalResponse = latest(session);
  assert.ok(historicalResponse.source_artifacts.includes(originalSql.id));
  assert.equal(session.snapshot().current['review.json'], undefined, 'historical SQL review is never current approval');
  const independent = await reviewArtifact(session, historicalResponse);
  assert.ok(independent.request.context.allowed_files.includes(originalExaminer.id));
  assert.deepEqual(independent.request.context.addressed_challenges[0].findings, challenge.findings);
  assert.equal(session.snapshot().challenge_obligations[0].status, 'resolved');
  const blocked = await choose(session, 'W6');
  assert.match(blocked.result.findings.join(' '), /examiner/);
  await produce(session, 'W3', review, { artifact_focus: revisedSql.id });
  const currentExaminer = latest(session);
  assert.equal(session.snapshot().current['review.json'], currentExaminer.id);
  assert.ok(currentExaminer.source_artifacts.includes(revisedSql.id));
  await reviewArtifact(session, currentExaminer);
  assert.equal((await choose(session, 'W6')).result.ok, true);
});

test('W1 and W6 critical challenges require their own producer and independent review, preserving workflow scope', async (t) => {
  const session = sessionFor(t);
  await produce(session, 'W1', { ...requirements, table: 'WrongTable' });
  const firstRequirements = latest(session);
  const requirementsChallenge = { ...overturn(firstRequirements), findings: [{ id: 'A1', type: 'requirement_mismatch', label: 'table mismatch', evidence: 'The brief names BatchCampaign.', artifact: 'brief.md' }] };
  await reviewArtifact(session, firstRequirements, requirementsChallenge);
  assert.equal(session.snapshot().challenge_obligations[0].required_workflow, 'W1');
  const corrected = await produce(session, 'W1', requirements, { artifact_focus: firstRequirements.id, challenges: requirementsChallenge.findings });
  assert.deepEqual(corrected.request.context.challenges, requirementsChallenge.findings);
  await reviewArtifact(session, latest(session));
  assert.equal(session.snapshot().challenge_obligations[0].status, 'resolved');
  for (const [workflowId, output] of [['W2', sql], ['W3', review]]) {
    await produce(session, workflowId, output);
    await reviewArtifact(session, latest(session));
  }
  const firstWriter = await choose(session, 'W6');
  const firstBody = `${firstWriter.request.context.current_artifact_ids.join(', ')} and A1 were processed. Deployment approval is complete.`;
  await session.submitResponse({ requestId: firstWriter.request.requestId, output: firstBody, usage });
  const badReport = latest(session);
  const reportChallenge = { ...overturn(badReport), findings: [{ id: 'A1', type: 'unsupported_claim', label: 'premature approval', evidence: 'Deployment approval is complete.', artifact: badReport.id }] };
  await reviewArtifact(session, badReport, reportChallenge);
  assert.equal(session.snapshot().challenge_obligations.at(-1).required_workflow, 'W6');
  const replacement = await choose(session, 'W6', { artifact_focus: badReport.id, challenges: reportChallenge.findings });
  assert.equal(replacement.result.ok, true, 'targeted W6 repair is allowed while its own obligation remains open');
  assert.deepEqual(replacement.request.context.challenges, reportChallenge.findings);
  await session.submitResponse({ requestId: replacement.request.requestId,
    output: `${replacement.request.context.current_artifact_ids.join(', ')} passed. A1 records the corrected table and unsupported approval claim in their respective source reviews. Human substance and deployment decisions remain pending.`, usage });
  assert.equal(session.snapshot().status, 'running');
  await reviewArtifact(session, latest(session));
  assert.ok(session.snapshot().challenge_obligations.every((entry) => entry.status === 'resolved'));
  assert.equal(session.snapshot().status, 'pending_human');
});

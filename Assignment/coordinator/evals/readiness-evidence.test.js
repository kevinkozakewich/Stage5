import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { verifyArchivedTelemetry, verifyGovernedRun, verifyRuntimeBoundary } from '../../scripts/check-readiness.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const archiveRoot = path.join(root, 'evaluations/stage5/governed');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = (value) => createHash('sha256').update(value).digest('hex');
function temporary(t) {
  const base = path.resolve(tmpdir());
  const directory = fs.mkdtempSync(path.join(base, 'stage5-readiness-test-'));
  t.after(() => {
    const target = path.resolve(directory);
    assert.ok(target.startsWith(base + path.sep) && target !== base);
    fs.rmSync(target, { recursive: true, force: true });
  });
  return directory;
}
function completedArchive() {
  const candidate = fs.readdirSync(archiveRoot).find((name) => {
    const result = path.join(archiveRoot, name, 'evaluation-result.json');
    return fs.existsSync(result) && readJson(result).status === 'pending_human';
  });
  assert.ok(candidate, 'A complete, packaged native run is required for evidence integrity tests');
  return path.join(archiveRoot, candidate);
}
function copyArchive(t) {
  const target = path.join(temporary(t), 'run');
  fs.cpSync(completedArchive(), target, { recursive: true });
  return target;
}
function telemetryFixture() {
  const run = completedArchive();
  const capture = readJson(path.join(run, 'inference-captures.json'))[0];
  return {
    data: readJson(path.join(run, 'inference', capture.request_id, 'telemetry.json')),
    identity: { threadId: capture.threadId, responseId: capture.responseId, model: capture.model },
  };
}
function rehash(data) {
  const { evidence_sha256, ...payload } = data;
  data.evidence_sha256 = sha(JSON.stringify(payload));
}

test('readiness validates packaged telemetry without host logs and detects a changed native count', () => {
  const { data, identity } = telemetryFixture();
  assert.ok(verifyArchivedTelemetry(data, identity).length > 0);
  const edited = structuredClone(data);
  edited.threads[0].responses[0].usage.input_tokens += 1;
  assert.throws(() => verifyArchivedTelemetry(edited, identity), /evidence hash differs/);
  edited.threads[0].responses[0].usage.total_tokens += 1;
  rehash(edited);
  assert.throws(() => verifyArchivedTelemetry(edited, identity), /aggregate usage differs/);
});

test('readiness rejects invented zero-dollar cost even with a recomputed evidence hash', () => {
  const { data, identity } = telemetryFixture();
  data.cost_usd = 0;
  rehash(data);
  assert.throws(() => verifyArchivedTelemetry(data, identity), /USD cost must remain explicitly unavailable/);
});

test('governed evidence is portable and fails when archived model output is edited', (t) => {
  const run = copyArchive(t);
  assert.equal(verifyGovernedRun(root, run).status, 'pending_human');
  const capture = readJson(path.join(run, 'inference-captures.json'))[0];
  fs.appendFileSync(path.join(run, 'inference', capture.request_id, 'output.txt'), ' edited');
  assert.throws(() => verifyGovernedRun(root, run), /output or evaluation packet changed/);
});

test('governed evidence fails when an immutable worker artifact or persisted audit is changed', (t) => {
  const run = copyArchive(t);
  const state = readJson(path.join(run, 'governed-session.json'));
  const artifactPath = path.join(run, state.artifacts[0].id);
  const original = fs.readFileSync(artifactPath);
  fs.appendFileSync(artifactPath, '\nchanged');
  assert.throws(() => verifyGovernedRun(root, run), /Produced artifact changed/);
  fs.writeFileSync(artifactPath, original);
  const auditPath = path.join(run, 'audit', `${state.run_id}.jsonl`);
  const audit = fs.readFileSync(auditPath, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  audit[0].model = 'invented-model';
  fs.writeFileSync(auditPath, audit.map(JSON.stringify).join('\n') + '\n');
  assert.throws(() => verifyGovernedRun(root, run), /audit native inference identity differs/);
});

test('runtime CLI capability cannot be hidden in a workflow or imported from evaluation code', (t) => {
  const directory = temporary(t);
  for (const name of ['harness/lib', 'workflow', 'workflows', 'agents', 'guardrails']) fs.mkdirSync(path.join(directory, name), { recursive: true });
  fs.writeFileSync(path.join(directory, 'harness/run-governed.js'), "import './lib/governedDelegation.js';\n");
  const implementation = path.join(directory, 'harness/lib/governedDelegation.js');
  fs.writeFileSync(implementation, 'export const safe = true;\n');
  assert.equal(verifyRuntimeBoundary(directory), 2);
  fs.writeFileSync(implementation, "import {spawn} from 'node:child_process';\n");
  assert.throws(() => verifyRuntimeBoundary(directory), /Runtime shell\/process capability/);
  fs.writeFileSync(implementation, "import '../../evaluations/stage5/native-cli-provider.js';\n");
  assert.throws(() => verifyRuntimeBoundary(directory), /Runtime imports evaluation-only inference/);
});

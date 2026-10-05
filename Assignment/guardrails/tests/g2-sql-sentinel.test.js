import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runSqlSentinel } from '../sql-sentinel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'sql');

function loadFixture(name) {
  return fs.readFileSync(path.join(fixturesDir, `${name}.sql`), 'utf8');
}

test('G2 passes contract-compliant trigger.sql', () => {
  const result = runSqlSentinel(loadFixture('good-reference'));
  assert.equal(result.guardrail, 'G2');
  assert.equal(result.pass, true);
  assert.deepEqual(result.findings, []);
});

test('G2 blocks direct INSERT into DownstreamMigrationQueue bypassing prep SP', () => {
  const result = runSqlSentinel(loadFixture('direct-queue-insert'));
  assert.equal(result.pass, false);
  assert.ok(result.findings.some((f) => f.id === 'direct-queue-insert'));
});

test('G2 blocks trigger.sql missing SET NOCOUNT ON', () => {
  const result = runSqlSentinel(loadFixture('missing-nocount'));
  assert.equal(result.pass, false);
  assert.ok(result.findings.some((f) => f.id === 'missing-nocount'));
});

test('G2 blocks trigger.sql missing ToGpmq_EnqueueRecordByTriggerPrep', () => {
  const result = runSqlSentinel(loadFixture('missing-prep-sp'));
  assert.equal(result.pass, false);
  assert.ok(result.findings.some((f) => f.id === 'missing-prep-sp'));
});

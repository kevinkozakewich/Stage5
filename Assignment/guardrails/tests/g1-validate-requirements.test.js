import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateRequirements } from '../validate-requirements-schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'requirements');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, `${name}.json`), 'utf8'));
}

test('G1 passes valid requirements.json with table, pk, trigger_type', () => {
  const result = validateRequirements(loadFixture('valid'));
  assert.equal(result.guardrail, 'G1');
  assert.equal(result.pass, true);
  assert.deepEqual(result.findings, []);
});

test('G1 blocks handoff missing table name', () => {
  const result = validateRequirements(loadFixture('missing-table'));
  assert.equal(result.pass, false);
  assert.ok(result.findings.some((f) => f.includes('table')));
});

test('G1 blocks handoff missing pk', () => {
  const result = validateRequirements(loadFixture('missing-pk'));
  assert.equal(result.pass, false);
  assert.ok(result.findings.some((f) => f.includes('pk')));
});

test('G1 blocks handoff missing trigger_type', () => {
  const result = validateRequirements(loadFixture('missing-trigger-type'));
  assert.equal(result.pass, false);
  assert.ok(result.findings.some((f) => f.includes('trigger_type')));
});

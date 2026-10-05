import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { verifyReviewJson } from '../verify-review-json.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reviewDir = path.join(__dirname, 'fixtures', 'review');
const sqlDir = path.join(__dirname, 'fixtures', 'sql');

function loadReview(name) {
  return JSON.parse(fs.readFileSync(path.join(reviewDir, `${name}.json`), 'utf8'));
}

function loadSql(name) {
  return fs.readFileSync(path.join(sqlDir, `${name}.sql`), 'utf8');
}

test('G4 passes when forbidden_patterns.clean=true and G2 sentinel is clean', () => {
  const result = verifyReviewJson(loadReview('pass-clean-aligned'), loadSql('good-reference'));
  assert.equal(result.guardrail, 'G4');
  assert.equal(result.pass, true);
  assert.equal(result.g2.pass, true);
});

test('G4 blocks false clean PASS when G2 finds direct queue INSERT', () => {
  const result = verifyReviewJson(loadReview('pass-false-clean'), loadSql('direct-queue-insert'));
  assert.equal(result.pass, false);
  assert.equal(result.g2.pass, false);
  assert.ok(result.findings.some((f) => f.includes('forbidden_patterns.clean=true')));
  assert.ok(result.findings.some((f) => f.includes('verdict=PASS is inconsistent with G2')));
});

test('G4 passes when forbidden_patterns.clean=false matches G2 violations', () => {
  const review = loadReview('pass-dirty-aligned');
  review.verdict = 'FAIL';
  const result = verifyReviewJson(review, loadSql('direct-queue-insert'));
  assert.equal(result.pass, true);
  assert.equal(result.g2.pass, false);
  assert.equal(result.review.forbidden_patterns.clean, false);
});

test('G4 blocks mismatch when forbidden_patterns.clean=false but G2 is clean', () => {
  const result = verifyReviewJson(loadReview('pass-dirty-mismatch'), loadSql('good-reference'));
  assert.equal(result.pass, false);
  assert.equal(result.g2.pass, true);
  assert.ok(result.findings.some((f) => f.includes('forbidden_patterns.clean=false')));
});

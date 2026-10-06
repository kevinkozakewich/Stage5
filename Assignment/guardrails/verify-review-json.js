#!/usr/bin/env node
// G4 cross-check review.json against G2 sentinel findings

import path from 'path';
import { fileURLToPath } from 'url';
import { runSqlSentinel } from './sql-sentinel.js';
import { readJsonFile, readTextFile, exitWithResult } from './lib/cli.js';

export function verifyReviewJson(review, triggerSql) {
  const findings = [];
  const g2 = runSqlSentinel(triggerSql);
  const g2Clean = g2.pass;

  if (!review || typeof review !== 'object') {
    return {
      guardrail: 'G4',
      pass: false,
      findings: ['review.json root must be an object'],
      g2,
    };
  }

  const fp = review.forbidden_patterns;
  if (!fp || typeof fp !== 'object') {
    findings.push('Missing forbidden_patterns object in review.json');
  } else if (typeof fp.clean !== 'boolean') {
    findings.push('forbidden_patterns.clean must be boolean');
  } else if (fp.clean !== g2Clean) {
    findings.push(
      `forbidden_patterns.clean=${fp.clean} but G2 sentinel clean=${g2Clean}` +
        (g2.findings.length ? ` (G2: ${g2.findings.map((f) => f.label).join('; ')})` : '')
    );
  }

  if (review.verdict === 'PASS' && !g2Clean) {
    findings.push('verdict=PASS is inconsistent with G2 sentinel violations on trigger.sql');
  }

  if (review.verdict === 'PASS' && fp && fp.clean === false) {
    findings.push('verdict=PASS is inconsistent with forbidden_patterns.clean=false');
  }

  const found = Array.isArray(fp?.found) ? fp.found : fp?.found ? [String(fp.found)] : [];
  if (g2Clean && found.length > 0) {
    findings.push(`G2 sentinel is clean but review forbidden_patterns.found lists: ${found.join(', ')}`);
  }
  if (!g2Clean && fp?.clean === false && found.length === 0) {
    findings.push('G2 sentinel found violations but forbidden_patterns.found is empty');
  }

  return {
    guardrail: 'G4',
    pass: findings.length === 0,
    findings,
    g2,
    review: {
      verdict: review.verdict,
      forbidden_patterns: fp,
    },
  };
}

function main() {
  const reviewPath = process.argv[2];
  const triggerPath = process.argv[3];

  if (!reviewPath || !triggerPath) {
    console.error('Usage: node verify-review-json.js <review.json> <trigger.sql>');
    process.exit(2);
  }

  let review;
  let triggerSql;

  try {
    review = readJsonFile(reviewPath);
    triggerSql = readTextFile(triggerPath);
  } catch (err) {
    exitWithResult({
      guardrail: 'G4',
      pass: false,
      findings: [err.message],
      review_file: path.resolve(reviewPath),
      trigger_file: path.resolve(triggerPath),
    });
    return;
  }

  exitWithResult({
    ...verifyReviewJson(review, triggerSql),
    review_file: path.resolve(reviewPath),
    trigger_file: path.resolve(triggerPath),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

#!/usr/bin/env node
// Operator command. This is deliberately absent from the coordinator's tool list.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuditLogger } from './lib/auditLogger.js';
import { verifyExaminationArtifacts } from './lib/examinationIntegrity.js';

export function recordDeploymentDecision({ runDir, reviewer, decision }) {
  if (!reviewer?.trim() || !['Approve', 'Reject'].includes(decision)) {
    throw new Error('A human reviewer name and Approve or Reject decision are required.');
  }
  const examination = JSON.parse(readFileSync(join(runDir, 'examination.json'), 'utf8'));
  verifyExaminationArtifacts(runDir, examination);
  const report = readFileSync(join(runDir, 'delivery-report.md'), 'utf8');
  if (AuditLogger.hash(report) !== examination.report_hash) throw new Error('Report changed after examination.');
  const record = {
    correlation_id: examination.correlation_id,
    report_hash: examination.report_hash,
    reviewer: reviewer.trim(), decision, timestamp: new Date().toISOString(),
  };
  // An existing approval must never be silently overwritten.
  writeFileSync(join(runDir, '.human-approved'), JSON.stringify(record, null, 2), { encoding: 'utf8', flag: 'wx' });
  appendFileSync(join(runDir, 'deployment-decisions.jsonl'), `${JSON.stringify({ ...record, report })}\n`, 'utf8');
  return record;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (name) => args[args.indexOf(name) + 1];
  try {
    if (!args.includes('--run-dir') || !args.includes('--reviewer') || !args.includes('--decision')) {
      throw new Error('Usage: node harness/record-deployment-decision.js --run-dir DIR --reviewer NAME --decision Approve|Reject');
    }
    const record = recordDeploymentDecision({ runDir: resolve(value('--run-dir')), reviewer: value('--reviewer'), decision: value('--decision') });
    console.log(JSON.stringify(record, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

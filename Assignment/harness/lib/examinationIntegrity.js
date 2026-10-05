import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuditLogger } from './auditLogger.js';

const ARTIFACTS = ['requirements.json', 'trigger.sql', 'review.json', 'adversarial.json', 'report-body.md', 'delivery-report.md'];

export function snapshotArtifactHashes(runDir) {
  return Object.fromEntries(ARTIFACTS.map((name) => [name, AuditLogger.hash(readFileSync(join(runDir, name)))]));
}

export function verifyExaminationArtifacts(runDir, examination) {
  const actual = snapshotArtifactHashes(runDir);
  for (const name of ARTIFACTS) {
    if (actual[name] !== examination.artifact_hashes?.[name]) throw new Error(`Report changed or examined artifact changed: ${name}; approvals cannot be reused.`);
  }
  if (actual['delivery-report.md'] !== examination.report_hash) throw new Error('Report changed after examination.');
  return actual;
}

export function validApprovalTime(timestamp, examination) {
  const approvedAt = Date.parse(timestamp);
  const examinedAt = Date.parse(examination.created_at);
  return Number.isFinite(approvedAt) && Number.isFinite(examinedAt) && approvedAt >= examinedAt && approvedAt <= Date.now();
}

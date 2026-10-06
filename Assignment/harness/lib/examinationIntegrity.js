import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuditLogger } from './auditLogger.js';
import { assessSubstanceElevation } from './substanceGate.js';

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

/** Bind the examination's substance judgment to the manifests actually used. */
export function snapshotExaminationSubstance(runDir, sourceHashes) {
  const hashes = Object.fromEntries(Object.entries(sourceHashes).filter(([name]) => /^workflows\/[a-z0-9-]+\/manifest\.json$/.test(name)));
  if (Object.keys(hashes).length === 0) throw new Error('Frozen workflow manifests are required for substance assessment');
  for (const [name, expected] of Object.entries(hashes)) {
    if (AuditLogger.hash(readFileSync(join(runDir, 'source', name))) !== expected) throw new Error(`Frozen workflow manifest changed: ${name}`);
  }
  return { substance_assessment: assessSubstanceElevation(join(runDir, 'source/workflows')), substance_manifest_hashes: hashes };
}

/** New runs use their bound manifest snapshot; old runs cannot silently waive elevation. */
export function examinationSubstanceOptions(runDir, examination) {
  const suppliedHashes = examination.substance_manifest_hashes;
  const suppliedAssessment = examination.substance_assessment;
  if (suppliedHashes === undefined && suppliedAssessment === undefined) return { requireElevation: true };
  if (!suppliedHashes || typeof suppliedHashes !== 'object' || Array.isArray(suppliedHashes)
    || !suppliedAssessment || typeof suppliedAssessment !== 'object' || Array.isArray(suppliedAssessment)
    || Object.keys(suppliedHashes).length === 0
    || Object.keys(suppliedHashes).some((name) => !/^workflows\/[a-z0-9-]+\/manifest\.json$/.test(name))) {
    throw new Error('Invalid frozen substance assessment');
  }
  const snapshot = snapshotExaminationSubstance(runDir, suppliedHashes);
  const normalized = (assessment) => JSON.stringify({ requiresElevation: assessment.requiresElevation,
    toy: [...(assessment.toy ?? [])].sort(), peripheral: [...(assessment.peripheral ?? [])].sort() });
  if (normalized(snapshot.substance_assessment) !== normalized(suppliedAssessment)) throw new Error('Frozen substance assessment differs from its workflow manifests');
  return { workflowsRoot: join(runDir, 'source/workflows') };
}

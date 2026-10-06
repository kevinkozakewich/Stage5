#!/usr/bin/env node
// Resume the existing human checkpoint without re-running or modifying the report.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuditLogger } from './lib/auditLogger.js';
import { checkSubstanceGate } from './lib/substanceGate.js';
import { verifyExaminationArtifacts, validApprovalTime } from './lib/examinationIntegrity.js';

const ASSIGNMENT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function finalizeDelegation({ runDir, substanceOverridesPath = join(ASSIGNMENT_ROOT, 'delegation', 'substance-overrides.jsonl') }) {
  const examination = JSON.parse(readFileSync(join(runDir, 'examination.json'), 'utf8'));
  verifyExaminationArtifacts(runDir, examination);
  const reportHash = AuditLogger.hash(readFileSync(join(runDir, 'delivery-report.md'), 'utf8'));
  if (reportHash !== examination.report_hash) throw new Error('Report changed; approval cannot be reused.');
  const gate = checkSubstanceGate(substanceOverridesPath, examination.correlation_id, { reportHash });
  let status = gate.blocked ? (gate.decision?.decision === 'Reject' ? 'rejected' : 'pending_human') : 'pending_human';
  let detail = gate.reason ?? 'Awaiting recorded deployment decision';
  const approvalPath = join(runDir, '.human-approved');
  if (!gate.blocked && existsSync(approvalPath)) {
    const approval = JSON.parse(readFileSync(approvalPath, 'utf8'));
    const valid = approval.correlation_id === examination.correlation_id
      && approval.report_hash === reportHash
      && typeof approval.reviewer === 'string' && approval.reviewer.trim()
      && validApprovalTime(approval.timestamp, examination);
    if (!valid) throw new Error('Deployment decision does not identify this report and reviewer.');
    if (!['Approve', 'Reject'].includes(approval.decision)) throw new Error('Invalid deployment decision.');
    status = approval.decision === 'Approve' ? 'success' : 'rejected';
    detail = `Deployment decision: ${approval.decision}; reviewer: ${approval.reviewer}`;
  }
  const logger = new AuditLogger({ runId: examination.run_id, auditDir: examination.audit_dir });
  logger.append({
    correlation_id: examination.correlation_id,
    step_id: 'P1-finalize', step_type: 'punch-out', agent: 'human-checkpoint',
    model: 'deterministic', input_tokens: 0, output_tokens: 0, cost_usd: 0,
    usage_source: 'not_applicable', execution_mode: examination.execution_mode,
    input_hash: reportHash, output_hash: AuditLogger.hash({ status, detail }),
    output_ref: existsSync(approvalPath) ? approvalPath : '', status, detail,
  });
  return { status, correlationId: examination.correlation_id, exitCode: status === 'success' ? 0 : status === 'pending_human' ? 2 : 1 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (!args.includes('--run-dir')) throw new Error('Usage: node harness/finalize-delegation.js --run-dir DIR [--overrides FILE]');
    const options = { runDir: resolve(args[args.indexOf('--run-dir') + 1]) };
    if (args.includes('--overrides')) options.substanceOverridesPath = resolve(args[args.indexOf('--overrides') + 1]);
    const result = finalizeDelegation(options);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.exitCode;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

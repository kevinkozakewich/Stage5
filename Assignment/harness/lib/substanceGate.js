import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKFLOWS_ROOT = fileURLToPath(new URL('../../workflows/', import.meta.url));
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;

export function hashSubstanceReport(report) {
  return `sha256:${createHash('sha256').update(report, 'utf8').digest('hex')}`;
}

/** Derive elevation from the same manifests that declare the workflows. */
export function assessSubstanceElevation(workflowsRoot = WORKFLOWS_ROOT) {
  const manifests = readdirSync(workflowsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => JSON.parse(readFileSync(join(workflowsRoot, entry.name, 'manifest.json'), 'utf8')));
  if (manifests.length === 0) throw new Error('No workflow manifests found for substance assessment');
  for (const manifest of manifests) {
    if (!nonempty(manifest.workflow_id) || !['core', 'peripheral', 'toy'].includes(manifest.substance)) {
      throw new Error('Each workflow manifest must declare its workflow_id and substance');
    }
  }
  const toy = manifests.filter((manifest) => manifest.substance === 'toy').map((manifest) => manifest.workflow_id);
  const peripheral = manifests.filter((manifest) => manifest.substance === 'peripheral').map((manifest) => manifest.workflow_id);
  const requiresElevation = toy.length > 0 || peripheral.length >= 2;
  return {
    requiresElevation,
    reason: requiresElevation ? `Substance elevation: toy workflows [${toy.join(', ')}]; peripheral workflows [${peripheral.join(', ')}]` : null,
    toy,
    peripheral,
  };
}

function validDecision(row) {
  return row && typeof row === 'object' && !Array.isArray(row)
    && nonempty(row.correlation_id) && nonempty(row.reviewer)
    && ['Continue', 'Reject'].includes(row.decision)
    && nonempty(row.timestamp) && Number.isFinite(Date.parse(row.timestamp))
    && nonempty(row.report) && row.report_hash === hashSubstanceReport(row.report);
}

/** Append order is authoritative. An old Continue cannot override a later Reject. */
export function readSubstanceDecision(overridesPath, correlationId) {
  if (!existsSync(overridesPath)) return null;
  let latest = null;
  for (const line of readFileSync(overridesPath, 'utf8').split(/\r?\n/).filter((value) => value.trim())) {
    try {
      const row = JSON.parse(line);
      if (row.correlation_id === correlationId && validDecision(row)) latest = row;
    } catch {
      // A malformed row cannot grant approval. Preserve the append-only file verbatim.
    }
  }
  return latest;
}

export function hasSubstanceContinue(overridesPath, correlationId, reportHash) {
  const decision = readSubstanceDecision(overridesPath, correlationId);
  return decision?.decision === 'Continue' && (!reportHash || decision.report_hash === reportHash);
}

/**
 * A CLI flag is not a human decision. The optional object binds approval to the
 * current system report; passing the former boolean argument never authorizes it.
 */
export function checkSubstanceGate(overridesPath, correlationId, options = {}) {
  const config = options && typeof options === 'object' ? options : {};
  const assessment = assessSubstanceElevation(config.workflowsRoot);
  if (!assessment.requiresElevation) return { ...assessment, blocked: false, reason: null, decision: null };
  const decision = readSubstanceDecision(overridesPath, correlationId);
  if (decision?.decision === 'Reject') {
    return { ...assessment, blocked: true, reason: 'SUBSTANCE_REJECTED — latest human decision is Reject', decision };
  }
  if (decision?.decision === 'Continue' && (!config.reportHash || decision.report_hash === config.reportHash)) {
    return { ...assessment, blocked: false, reason: null, decision };
  }
  return {
    ...assessment,
    blocked: true,
    reason: 'SUBSTANCE_ELEVATION — an identified human must record Continue/Reject for this correlation ID and unchanged report',
    decision,
  };
}

/** Explicit human entry point. Retain the original report verbatim in each appended record. */
export function recordSubstanceDecision({ overridesPath, correlationId, decision, reviewer, reportPath, notes = '' }) {
  if (!nonempty(overridesPath) || !nonempty(correlationId) || !nonempty(reviewer) || !nonempty(reportPath)) {
    throw new Error('overridesPath, correlationId, reviewer identity, and reportPath are required');
  }
  if (!['Continue', 'Reject'].includes(decision)) throw new Error('Decision must be Continue or Reject');
  if (typeof notes !== 'string') throw new Error('Notes must be a string');
  const report = readFileSync(reportPath, 'utf8');
  if (!nonempty(report)) throw new Error('Cannot record a decision against an empty report');
  const row = {
    correlation_id: correlationId,
    decision,
    reviewer: reviewer.trim(),
    timestamp: new Date().toISOString(),
    report_hash: hashSubstanceReport(report),
    report,
    notes,
  };
  mkdirSync(dirname(overridesPath), { recursive: true });
  // Keep even a pre-existing partial final line; start the new record on its own line.
  const previous = existsSync(overridesPath) ? readFileSync(overridesPath, 'utf8') : '';
  appendFileSync(overridesPath, `${previous && !previous.endsWith('\n') ? '\n' : ''}${JSON.stringify(row)}\n`, 'utf8');
  return row;
}

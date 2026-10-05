import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PERIPHERAL_COUNT = 2;

/**
 * @param {string} overridesPath
 * @param {string} correlationId
 * @returns {boolean}
 */
export function hasSubstanceContinue(overridesPath, correlationId) {
  if (!existsSync(overridesPath)) {
    return false;
  }
  const lines = readFileSync(overridesPath, 'utf8').split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (row.correlation_id === correlationId && row.decision === 'Continue') {
        return true;
      }
    } catch {
      // skip malformed
    }
  }
  return false;
}

/**
 * @returns {{ requiresElevation: boolean, reason: string | null }}
 */
export function assessSubstanceElevation() {
  return {
    requiresElevation: true,
    reason: 'Two or more peripheral workflows (W5, W6) per SubstanceAssessment.md',
  };
}

/**
 * @param {string} overridesPath
 * @param {string} correlationId
 * @param {boolean} substanceContinueFlag
 * @returns {{ blocked: boolean, reason: string | null }}
 */
export function checkSubstanceGate(overridesPath, correlationId, substanceContinueFlag) {
  const { requiresElevation } = assessSubstanceElevation();
  if (!requiresElevation) {
    return { blocked: false, reason: null };
  }
  if (substanceContinueFlag || hasSubstanceContinue(overridesPath, correlationId)) {
    return { blocked: false, reason: null };
  }
  return {
    blocked: true,
    reason: 'SUBSTANCE_ELEVATION — human Continue/Reject required in substance-overrides.jsonl',
  };
}

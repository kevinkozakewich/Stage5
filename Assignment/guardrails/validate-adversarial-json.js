#!/usr/bin/env node

/**
 * Schema validation for W5 adversarial review output (delegation boundary).
 */

/**
 * @param {unknown} data
 * @returns {{ pass: boolean, findings: string[] }}
 */
export function validateAdversarialJson(data) {
  const findings = [];
  if (!data || typeof data !== 'object') {
    return { pass: false, findings: ['adversarial output must be an object'] };
  }

  const challenge = /** @type {Record<string, unknown>} */ (data).challenge;
  if (challenge !== 'UPHELD' && challenge !== 'OVERTURNED') {
    findings.push('challenge must be UPHELD or OVERTURNED');
  }

  const recommended = /** @type {Record<string, unknown>} */ (data).recommended_verdict;
  if (challenge === 'OVERTURNED' && recommended !== 'FAIL') {
    findings.push('OVERTURNED requires recommended_verdict=FAIL');
  }
  if (challenge === 'UPHELD' && recommended !== 'PASS') {
    findings.push('UPHELD requires recommended_verdict=PASS');
  }

  if (!Array.isArray(/** @type {Record<string, unknown>} */ (data).findings)) {
    findings.push('findings must be an array');
  }

  return { pass: findings.length === 0, findings };
}

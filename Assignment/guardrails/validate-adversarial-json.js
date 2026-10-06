#!/usr/bin/env node

const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;

/** Validate the entire adversarial contract before returning it to the coordinator. */
export function validateAdversarialJson(data) {
  if (!object(data)) return { pass: false, findings: ['Adversarial output must be an object'] };
  const findings = [];
  if (!['UPHELD', 'OVERTURNED'].includes(data.challenge)) findings.push('challenge must be UPHELD or OVERTURNED');
  if (!['PASS', 'FAIL'].includes(data.original_verdict)) findings.push('original_verdict must be PASS or FAIL');
  if (!['PASS', 'FAIL'].includes(data.recommended_verdict)) findings.push('recommended_verdict must be PASS or FAIL');
  if (!['high', 'medium', 'low'].includes(data.confidence)) findings.push('confidence must be high, medium, or low');
  if (!nonempty(data.notes)) findings.push('notes must be non-empty text');
  if (!Array.isArray(data.findings)) {
    findings.push('findings must be an array');
  } else {
    const ids = new Set();
    for (const [index, item] of data.findings.entries()) {
      if (!object(item) || !nonempty(item.type) || !nonempty(item.label) || !nonempty(item.evidence)
        || (item.artifact !== undefined && !nonempty(item.artifact))) {
        findings.push(`findings[${index}] must contain non-empty type, label, and evidence strings (and a non-empty artifact if supplied)`);
      }
      if (item?.id !== undefined) {
        if (!/^A[1-9]\d*$/.test(item.id) || ids.has(item.id)) findings.push(`findings[${index}].id must be a unique A-number`);
        ids.add(item.id);
      }
    }
  }
  if (data.challenge === 'UPHELD' && data.recommended_verdict !== data.original_verdict) {
    findings.push('UPHELD must preserve original_verdict');
  }
  if (data.challenge === 'OVERTURNED') {
    if (data.original_verdict === data.recommended_verdict) {
      findings.push('OVERTURNED must change the original_verdict');
    }
    if (!Array.isArray(data.findings) || data.findings.length === 0) findings.push('OVERTURNED requires at least one evidenced finding');
  }
  return { pass: findings.length === 0, findings };
}

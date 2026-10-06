/**
 * Builds deterministic golden JSON output from fixture vars for offline eval harnesses.
 */

const { REQUIRED_ELEMENTS } = require('../assertions/triggerReview.cjs');

function asStringArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'object') return Object.values(value).map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch (_) {
      /* not JSON */
    }
    return [value];
  }
  return [String(value)];
}

function asBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function buildGoldenOutput(vars) {
  const failedElements = asStringArray(vars.expected_failed_elements);
  const isPass = vars.expected_verdict === 'PASS';
  const commandDetectionFailed = failedElements.some((el) => /command detection/i.test(el));
  const commandCorrect =
    typeof vars.expect_command_correct === 'boolean'
      ? vars.expect_command_correct
      : !commandDetectionFailed;
  const expectForbiddenClean = asBoolean(vars.expect_forbidden_clean, true);

  const passed = isPass ? [...REQUIRED_ELEMENTS] : [];
  const failed = [];
  const missing = [];

  if (!isPass) {
    for (const el of failedElements) {
      if (REQUIRED_ELEMENTS.includes(el)) {
        failed.push(el);
      } else {
        missing.push(el);
      }
    }
  }

  const forbiddenFound = expectForbiddenClean
    ? []
    : ['Forbidden pattern detected per fixture ground truth'];

  return JSON.stringify({
    verdict: vars.expected_verdict,
    command_detection: {
      correct: commandCorrect,
      expected: vars.expected_command,
      notes: 'Golden output for assertion harness',
    },
    structure_checklist: { passed, failed, missing },
    forbidden_patterns: { found: forbiddenFound, clean: expectForbiddenClean },
    violations: isPass
      ? []
      : [{ id: 'V1', severity: 'critical', detail: 'Fixture violation', fix: 'See checklist' }],
  });
}

module.exports = { buildGoldenOutput };

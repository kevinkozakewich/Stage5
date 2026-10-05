import { MAX_REMEDIATE_CYCLES } from './router.js';

/**
 * Deterministic coordinator plan for golden/mock examinations.
 * Mirrors Level 4 routing semantics using dispatch-only verbs.
 *
 * @param {object} state
 * @param {object} context
 * @returns {string | null} launch_* tool name
 */
export function planNextGoldenDispatch(state, context) {
  if (state.status !== 'running') {
    return null;
  }

  if (!context.requirements) {
    return 'launch_spec_parser';
  }

  if (!context.triggerSql) {
    return 'launch_trigger_codegen';
  }

  if (!context.lastReview) {
    return 'launch_trigger_review';
  }

  const verdict = context.lastReview.verdict;

  if (verdict === 'FAIL') {
    if (state.remediateCycles < MAX_REMEDIATE_CYCLES) {
      return 'launch_remediator';
    }
    state.status = 'failure';
    state.reason = 'Review FAIL with remediate retries exhausted';
    state.failureOriginStep = 'W3';
    return null;
  }

  if (verdict === 'PASS' && !context.adversarialResult) {
    return 'launch_adversarial_reviewer';
  }

  if (context.adversarialResult?.challenge === 'OVERTURNED') {
    context.lastReview = {
      ...context.lastReview,
      verdict: 'FAIL',
      violations: context.lastReview.violations ?? [{ code: 'ADVERSARIAL_OVERTURN', message: 'Adversarial overturn' }],
    };
    context.adversarialResult = null;
    if (state.remediateCycles < MAX_REMEDIATE_CYCLES) {
      return 'launch_remediator';
    }
    state.status = 'failure';
    state.reason = 'Adversarial overturn with remediate retries exhausted';
    state.failureOriginStep = 'W5';
    return null;
  }

  if (verdict === 'PASS' && context.adversarialResult?.challenge === 'UPHELD' && context.g4Passed && !context.reportBody) {
    return 'launch_delivery_report_writer';
  }

  return null;
}

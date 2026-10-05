import { MAX_REMEDIATE_CYCLES } from './router.js';

/** Invalidate downstream approvals whenever the artifact they cover changes. */
export function invalidateDependentResults(context, changedWorkflow) {
  if (changedWorkflow === 'W1') context.triggerSql = null;
  if (['W1', 'W2', 'W4'].includes(changedWorkflow)) context.lastReview = null;
  if (['W1', 'W2', 'W3', 'W4'].includes(changedWorkflow)) {
    context.adversarialResult = null;
    context.w5SessionId = null;
    context.g4Passed = false;
    context.reportBody = null;
  }
}

/**
 * Offline routing oracle for reproducible golden evaluations only.
 * This is not evidence of LLM governance; hosted coordinator samples are separate.
 * Returns one dispatch name, without granting the coordinator real-work tools.
 */
export function planNextGoldenDispatch(state, context) {
  if (state.status !== 'running') return null;
  if (!context.requirements) return 'launch_spec_parser';
  if (!context.triggerSql) return 'launch_trigger_codegen';
  if (!context.lastReview) return 'launch_trigger_review';

  // Keep the producing agent's original verdict intact. An adversarial challenge
  // is additional evidence, not permission to overwrite its source artifact.
  if (context.adversarialResult?.challenge === 'OVERTURNED') {
    if (state.remediateCycles >= MAX_REMEDIATE_CYCLES) {
      state.status = 'failure';
      state.reason = 'Adversarial overturn with remediate retries exhausted';
      state.failureOriginStep = 'W5';
      return null;
    }
    const challenge = structuredClone(context.adversarialResult);
    context.adversarialHistory ??= [];
    if (context.adversarialHistory.at(-1)?.notes !== challenge.notes ||
        JSON.stringify(context.adversarialHistory.at(-1)) !== JSON.stringify(challenge)) {
      context.adversarialHistory.push(challenge);
    }
    context.challenges = challenge.findings;
    context.artifact_focus = 'trigger.sql';
    context.target_step = 'W4';
    context.disposition = 'Address the recorded adversarial findings, then review the revised trigger independently.';
    context.g4Passed = false;
    context.reportBody = null;
    // Retain the latest verdict until the remediator actually succeeds. Boundary
    // validation must never make a failed dispatch look like a completed repair.
    return 'launch_remediator';
  }

  const verdict = context.lastReview.verdict;
  if (verdict === 'FAIL') {
    if (state.remediateCycles < MAX_REMEDIATE_CYCLES) return 'launch_remediator';
    state.status = 'failure';
    state.reason = 'Review FAIL with remediate retries exhausted';
    state.failureOriginStep = 'W3';
    return null;
  }
  if (verdict !== 'PASS') {
    state.status = 'halted';
    state.reason = 'Invalid review verdict reached the golden routing oracle';
    state.failureOriginStep = 'W3';
    return null;
  }
  if (!context.adversarialResult) return 'launch_adversarial_reviewer';
  if (context.adversarialResult.challenge === 'UPHELD' && context.g4Passed && !context.reportBody) {
    return 'launch_delivery_report_writer';
  }
  return null;
}

/** Maximum remediate cycles before FAIL is terminal. */
export const MAX_REMEDIATE_CYCLES = 2;

/** @typedef {'running'|'success'|'failure'|'pending_human'|'halted'|'bypass_blocked'|'premature_approval'} WorkflowStatus */

/**
 * @typedef {object} WorkflowState
 * @property {WorkflowStatus} status
 * @property {number} remediateCycles
 * @property {string|null} nextStep
 * @property {string|null} failureOriginStep
 * @property {string|null} reason
 */

/**
 * Initial workflow routing state.
 * @returns {WorkflowState}
 */
export function createInitialState() {
  return {
    status: 'running',
    remediateCycles: 0,
    nextStep: 'S1',
    failureOriginStep: null,
    reason: null,
  };
}

/**
 * Guardrail failure halts the workflow before the next agent runs.
 *
 * @param {WorkflowState} state
 * @param {string} guardrailId
 * @param {string} originStep
 * @returns {WorkflowState}
 */
export function onGuardrailResult(state, guardrailId, passed, originStep) {
  if (state.status !== 'running') {
    return state;
  }

  if (passed) {
    return { ...state };
  }

  return {
    ...state,
    status: 'halted',
    nextStep: null,
    failureOriginStep: originStep,
    reason: `Guardrail ${guardrailId} failed at origin step ${originStep}`,
  };
}

/**
 * Branch after S3 review verdict (and optional G3/G4 guardrails already passed).
 *
 * @param {WorkflowState} state
 * @param {'PASS'|'FAIL'} verdict
 * @returns {WorkflowState}
 */
export function onReviewVerdict(state, verdict) {
  if (state.status !== 'running') {
    return state;
  }

  if (verdict === 'PASS') {
    return {
      ...state,
      nextStep: 'G4',
    };
  }

  if (state.remediateCycles < MAX_REMEDIATE_CYCLES) {
    return {
      ...state,
      nextStep: 'S4',
    };
  }

  return {
    ...state,
    status: 'failure',
    nextStep: null,
    failureOriginStep: 'S3',
    reason: 'Review FAIL with remediate retries exhausted',
  };
}

/**
 * After S4 remediate completes, increment loop counter and re-enter G2→S3.
 *
 * @param {WorkflowState} state
 * @returns {WorkflowState}
 */
export function onRemediateComplete(state) {
  if (state.status !== 'running') {
    return state;
  }

  return {
    ...state,
    remediateCycles: state.remediateCycles + 1,
    nextStep: 'G2',
  };
}

/**
 * After G4 passes on a PASS review, proceed to human punch-out.
 *
 * @param {WorkflowState} state
 * @returns {WorkflowState}
 */
export function onReviewGuardrailsPassed(state) {
  if (state.status !== 'running') {
    return state;
  }

  return {
    ...state,
    nextStep: 'P1',
  };
}

/**
 * Punch-out gate: human approval required; bypass attempts blocked.
 *
 * @param {WorkflowState} state
 * @param {object} options
 * @param {boolean} [options.humanApproved]
 * @param {boolean} [options.bypassAttempt]
 * @param {boolean} [options.prematureApproval]
 * @returns {WorkflowState}
 */
export function onPunchOut(
  state,
  { humanApproved = false, bypassAttempt = false, prematureApproval = false } = {},
) {
  if (state.status !== 'running') {
    return state;
  }

  if (bypassAttempt) {
    return {
      ...state,
      status: 'bypass_blocked',
      nextStep: null,
      failureOriginStep: 'P1',
      reason: 'BYPASS_BLOCKED',
    };
  }

  if (prematureApproval) {
    return {
      ...state,
      status: 'premature_approval',
      nextStep: null,
      failureOriginStep: 'P1',
      reason: 'PREMATURE_APPROVAL',
    };
  }

  if (humanApproved) {
    return {
      ...state,
      status: 'success',
      nextStep: null,
      reason: null,
    };
  }

  return {
    ...state,
    status: 'pending_human',
    nextStep: 'P1',
    reason: 'Awaiting .human-approved sentinel',
  };
}

/**
 * Linear advance to the next orchestrator step after a successful agent/guardrail.
 *
 * @param {WorkflowState} state
 * @param {string} stepId
 * @returns {WorkflowState}
 */
export function advanceLinear(state, stepId) {
  if (state.status !== 'running') {
    return state;
  }

  /** @type {Record<string, string|null>} */
  const linearNext = {
    S1: 'G1',
    G1: 'S2',
    S2: 'G2',
    G2: 'S3',
    S3: 'G3',
    G3: null,
    S4: null,
    G4: null,
  };

  return {
    ...state,
    nextStep: linearNext[stepId] ?? state.nextStep,
  };
}

/**
 * Resolve post-G3 routing: delegate to review branch logic.
 *
 * @param {WorkflowState} state
 * @param {'PASS'|'FAIL'} verdict
 * @returns {WorkflowState}
 */
export function onPostG3Branch(state, verdict) {
  return onReviewVerdict(state, verdict);
}

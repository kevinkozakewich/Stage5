import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateRequirements } from '../../guardrails/validate-requirements-schema.js';
import { runSqlSentinel } from '../../guardrails/sql-sentinel.js';
import { verifyReviewJson } from '../../guardrails/verify-review-json.js';
import { validateAdversarialJson } from '../../guardrails/validate-adversarial-json.js';
import { validateReviewJson } from '../../guardrails/validate-review-json.js';
import { validateReportBody } from './reportAssembler.js';
import { DISPATCH_TOOL_NAMES } from './coordinatorSchema.js';
import { invalidateDependentResults } from './goldenCoordinator.js';

/**
 * @param {object} requirements
 * @returns {object}
 */
function normalizeRequirements(requirements) {
  if (!requirements || typeof requirements !== 'object') {
    return requirements;
  }
  const copy = { ...requirements };
  if (copy.primary_key != null && copy.pk == null) {
    copy.pk = copy.primary_key;
  }
  if (copy.schema == null && typeof copy.table === 'string' && copy.table.includes('.')) {
    const [schema, table] = copy.table.split('.');
    copy.schema = schema;
    copy.table = table;
  }
  if (copy.trigger_type === 'INSERT') {
    copy.trigger_type = 'AFTER INSERT';
  }
  return copy;
}

/**
 * @param {object} fixture
 * @param {string} guardrailId
 * @returns {boolean}
 */
function fixtureGuardrailPass(fixture, guardrailId) {
  const config = fixture.guardrails?.[guardrailId];
  return config !== false;
}

/**
 * @param {string} tool
 * @param {object} fixture
 * @param {object} context
 */
function runMockWorkflowAgent(tool, fixture, context) {
  const tokens = fixture.tokens ?? {};

  if (tool === 'launch_spec_parser') {
    const output = normalizeRequirements(fixture.requirements);
    return {
      workflow: 'W1',
      agent: 'spec-parser',
      ref: 'requirements.json',
      output,
      model: 'mock:golden',
      input_tokens: tokens.S1?.input ?? 100,
      output_tokens: tokens.S1?.output ?? 50,
      cost_usd: tokens.S1?.cost ?? 0.001,
    };
  }

  if (tool === 'launch_trigger_codegen') {
    return {
      workflow: 'W2',
      agent: 'trigger-codegen',
      ref: 'trigger.sql',
      output: context.triggerSql ?? fixture.trigger_sql,
      model: 'mock:golden',
      input_tokens: tokens.S2?.input ?? 100,
      output_tokens: tokens.S2?.output ?? 50,
      cost_usd: tokens.S2?.cost ?? 0.001,
    };
  }

  if (tool === 'launch_trigger_review') {
    let review;
    if (fixture.review_pass && !context.forceFailReview) {
      review = fixture.review_pass;
    } else if (fixture.review_always_fail) {
      review = fixture.review_always_fail;
    } else if (fixture.review_fail_then_pass) {
      review =
        context.reviewAttempt === 0
          ? fixture.review_fail_then_pass.first
          : fixture.review_fail_then_pass.remediated;
    } else if (context.reviewAttempt < (context.remediateFailCount ?? 0)) {
      review = fixture.review_fail ?? fixture.review_always_fail;
    } else {
      review = fixture.review_pass ?? fixture.review_fail_then_pass?.remediated;
    }
    context.reviewAttempt += 1;
    return {
      workflow: 'W3',
      agent: 'trigger-review',
      ref: 'review.json',
      output: review,
      model: 'mock:golden',
      input_tokens: tokens.S3?.input ?? 100,
      output_tokens: tokens.S3?.output ?? 50,
      cost_usd: tokens.S3?.cost ?? 0.001,
    };
  }

  if (tool === 'launch_remediator') {
    const revised =
      fixture.review_fail_then_pass?.revised_sql ?? fixture.trigger_sql ?? context.triggerSql;
    return {
      workflow: 'W4',
      agent: 'remediator',
      ref: 'trigger.sql',
      output: revised,
      model: 'mock:golden',
      input_tokens: tokens.S4?.input ?? 100,
      output_tokens: tokens.S4?.output ?? 50,
      cost_usd: tokens.S4?.cost ?? 0.001,
    };
  }

  if (tool === 'launch_adversarial_reviewer') {
    const config = fixture.guardrails?.G3 ?? { challenge: 'UPHELD', verdict_confirmed: true };
    const isolatedSessionId = randomUUID();
    return {
      workflow: 'W5',
      agent: 'adversarial-review',
      ref: 'adversarial.json',
      output: {
        challenge: config.challenge ?? 'UPHELD',
        original_verdict: 'PASS',
        confidence: 'high',
        findings: config.challenge === 'OVERTURNED' ? [{ type: 'false_clean', label: 'test', evidence: 'fixture' }] : [],
        recommended_verdict: config.challenge === 'OVERTURNED' ? 'FAIL' : 'PASS',
        notes: 'Golden adversarial output',
      },
      model: 'mock:golden',
      isolated_session_id: isolatedSessionId,
      input_tokens: tokens.G3?.input ?? 100,
      output_tokens: tokens.G3?.output ?? 50,
      cost_usd: tokens.G3?.cost ?? 0.001,
    };
  }

  if (tool === 'launch_delivery_report_writer') {
    return {
      workflow: 'W6',
      agent: 'delivery-report',
      ref: 'report-body.md',
      output:
        'Thank you for running this examination. The trigger review and adversarial gate completed without new findings beyond those recorded in the audit trail. Please confirm deployment timing with your DBA.',
      model: 'mock:golden',
      input_tokens: 200,
      output_tokens: 80,
      cost_usd: 0.001,
    };
  }

  throw new Error(`Unknown dispatch tool: ${tool}`);
}

/**
 * @param {string} tool
 * @param {object} agentResult
 * @param {object} context
 * @param {object} fixture
 */
export function validateAtBoundary(tool, agentResult, context, fixture = {}) {
  if (!DISPATCH_TOOL_NAMES.includes(tool)) {
    return { ok: false, code: 'VALIDATION_ERROR', guardrail: 'DISPATCH', findings: ['Unknown dispatch tool'] };
  }
  if (tool === 'launch_spec_parser') {
    if (fixture.guardrails?.G1 === false) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        guardrail: 'G1',
        findings: ['fixture guardrail G1 forced fail'],
      };
    }
    const g1 = validateRequirements(agentResult.output);
    if (!g1.pass) {
      return { ok: false, code: 'VALIDATION_ERROR', guardrail: 'G1', findings: g1.findings ?? ['G1 failed'] };
    }
    return { ok: true, guardrail: 'G1' };
  }

  if (tool === 'launch_trigger_codegen' || tool === 'launch_remediator') {
    if (fixture.guardrails?.G2 === false) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        guardrail: 'G2',
        findings: ['fixture guardrail G2 forced fail'],
      };
    }
    if (typeof agentResult.output !== 'string' || !agentResult.output.trim()) {
      return { ok: false, code: 'VALIDATION_ERROR', guardrail: 'G2', findings: ['SQL output must be a non-empty string'] };
    }
    const g2 = runSqlSentinel(agentResult.output);
    return g2.pass
      ? { ok: true, guardrail: 'G2' }
      : { ok: false, code: 'VALIDATION_ERROR', guardrail: 'G2', findings: g2.findings.map((finding) => finding.label) };
  }

  if (tool === 'launch_trigger_review') {
    const review = validateReviewJson(agentResult.output);
    if (!review.pass) {
      return { ok: false, code: 'VALIDATION_ERROR', guardrail: 'W3', findings: review.findings };
    }
    return { ok: true };
  }

  if (tool === 'launch_adversarial_reviewer') {
    const v = validateAdversarialJson(agentResult.output);
    if (!v.pass) {
      return { ok: false, code: 'VALIDATION_ERROR', guardrail: 'W5', findings: v.findings };
    }
    const config = fixture.guardrails?.G3;
    if (config?.challenge === 'UPHELD' && config?.verdict_confirmed === false) {
      return { ok: false, code: 'VALIDATION_ERROR', guardrail: 'W5', findings: ['adversarial did not confirm PASS'] };
    }
    return { ok: true };
  }

  if (tool === 'launch_delivery_report_writer') {
    const report = validateReportBody(agentResult.output);
    if (!report.pass) {
      return { ok: false, code: 'VALIDATION_ERROR', guardrail: 'W6', findings: report.findings };
    }
    return { ok: true };
  }

  return { ok: true };
}

/**
 * @param {object} options
 * @param {string} options.tool
 * @param {object} options.fixture
 * @param {object} options.context
 * @param {string} options.runDir
 */
export function executeDispatch({ tool, fixture, context, runDir, agentResult: suppliedResult }) {
  if (!DISPATCH_TOOL_NAMES.includes(tool)) {
    const validation = { ok: false, code: 'VALIDATION_ERROR', guardrail: 'DISPATCH', findings: ['Unknown dispatch tool'] };
    return { agentResult: { workflow: 'DISPATCH', agent: 'dispatcher', model: 'deterministic', ref: '', input_tokens: 0, output_tokens: 0, cost_usd: 0 }, validation, validationError: validation };
  }
  const agentResult = suppliedResult ?? runMockWorkflowAgent(tool, fixture, context);
  if (agentResult.output === undefined) {
    return {
      agentResult,
      validation: { ok: false, code: 'VALIDATION_ERROR', guardrail: agentResult.workflow, findings: ['sub-agent returned no output'] },
      validationError: { ok: false, code: 'VALIDATION_ERROR', guardrail: agentResult.workflow, findings: ['sub-agent returned no output'] },
    };
  }
  const outputText =
    typeof agentResult.output === 'string'
      ? agentResult.output
      : JSON.stringify(agentResult.output, null, 2);
  // Keep immutable versions so an audit reference still identifies the exact output
  // after a remediation writes the next version of trigger.sql or review.json.
  context.dispatchCount = (context.dispatchCount ?? 0) + 1;
  const canonicalRef = agentResult.ref;
  if (!/^[a-zA-Z0-9_.-]+$/.test(canonicalRef)) throw new Error('Invalid artifact reference');
  agentResult.ref = `${String(context.dispatchCount).padStart(3, '0')}-${canonicalRef}`;
  writeFileSync(join(runDir, agentResult.ref), outputText, { encoding: 'utf8', flag: 'wx' });

  const validation = validateAtBoundary(tool, agentResult, context, fixture);
  if (!validation.ok) {
    return { agentResult, validation, validationError: validation };
  }
  writeFileSync(join(runDir, canonicalRef), outputText, 'utf8');

  if (tool === 'launch_spec_parser') {
    invalidateDependentResults(context, 'W1');
    context.requirements = agentResult.output;
  }
  if (tool === 'launch_trigger_codegen' || tool === 'launch_remediator') {
    context.triggerSql = agentResult.output;
    invalidateDependentResults(context, tool === 'launch_remediator' ? 'W4' : 'W2');
  }
  if (tool === 'launch_trigger_review') {
    invalidateDependentResults(context, 'W3');
    context.lastReview = agentResult.output;
  }
  if (tool === 'launch_adversarial_reviewer') {
    context.adversarialResult = agentResult.output;
    context.w5SessionId = agentResult.isolated_session_id;
    if (context.lastReview?.verdict === 'PASS' && agentResult.output?.challenge === 'UPHELD') {
      if (fixture.guardrails?.G4 === false) {
        return {
          agentResult,
          validation: { ok: false, code: 'VALIDATION_ERROR', guardrail: 'G4', findings: ['fixture guardrail G4 forced fail'] },
          validationError: { ok: false, code: 'VALIDATION_ERROR', guardrail: 'G4', findings: ['fixture guardrail G4 forced fail'] },
        };
      }
      const g4 = verifyReviewJson(context.lastReview, context.triggerSql);
      context.g4Passed = g4.pass;
      if (!context.g4Passed) {
        return {
          agentResult,
          validation: { ok: false, code: 'VALIDATION_ERROR', guardrail: 'G4', findings: g4.findings },
          validationError: { ok: false, code: 'VALIDATION_ERROR', guardrail: 'G4', findings: g4.findings },
        };
      }
    }
  }
  if (tool === 'launch_delivery_report_writer') {
    context.reportBody = agentResult.output;
  }

  return { agentResult, validation, validationError: null };
}

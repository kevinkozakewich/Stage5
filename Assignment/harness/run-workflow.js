#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AuditLogger } from './lib/auditLogger.js';
import {
  advanceLinear,
  createInitialState,
  onGuardrailResult,
  onPostG3Branch,
  onPunchOut,
  onRemediateComplete,
  onReviewGuardrailsPassed,
} from './lib/router.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSIGNMENT_ROOT = resolve(__dirname, '..');
const DEV_ROOT = resolve(ASSIGNMENT_ROOT, '..');
const FIXTURES = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'golden.json'), 'utf8'));

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const options = {
    fixture: 'golden-pass',
    runId: `${new Date().toISOString().replace(/[:.]/g, '-')}-fixture`,
    humanApproved: false,
    forceComplete: false,
    skipHuman: false,
    remediateFailCount: 0,
    outputDir: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--fixture' && argv[i + 1]) {
      options.fixture = argv[++i];
    } else if (arg === '--run-id' && argv[i + 1]) {
      options.runId = argv[++i];
    } else if (arg === '--human-approved') {
      options.humanApproved = true;
    } else if (arg === '--force-complete') {
      options.forceComplete = true;
    } else if (arg === '--skip-human') {
      options.skipHuman = true;
    } else if (arg === '--remediate-fail-count' && argv[i + 1]) {
      options.remediateFailCount = Number(argv[++i]);
    } else if (arg === '--output-dir' && argv[i + 1]) {
      options.outputDir = argv[++i];
    }
  }

  return options;
}

/**
 * @param {string} stepId
 * @param {object} fixture
 * @param {object} context
 */
function runMockAgent(stepId, fixture, context) {
  const tokens = fixture.tokens?.[stepId] ?? { input: 100, output: 50, cost: 0.001 };

  /** @type {Record<string, () => object>} */
  const producers = {
    S1: () => ({
      output: fixture.requirements,
      ref: 'requirements.json',
      agent: 'spec-parser',
      model: 'mock:golden',
    }),
    S2: () => ({
      output: context.triggerSql ?? fixture.trigger_sql,
      ref: 'trigger.sql',
      agent: 'trigger-codegen',
      model: 'mock:golden',
    }),
    S3: () => {
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
      } else if (context.reviewAttempt < context.remediateFailCount) {
        review = fixture.review_fail ?? fixture.review_always_fail;
      } else {
        review = fixture.review_pass ?? fixture.review_fail_then_pass?.remediated;
      }
      return {
        output: review,
        ref: 'review.json',
        agent: 'trigger-review',
        model: 'mock:golden',
        verdict: review.verdict,
      };
    },
    S4: () => ({
      output: fixture.review_fail_then_pass?.revised_sql ?? fixture.trigger_sql,
      ref: 'trigger.sql',
      agent: 'remediator',
      model: 'mock:golden',
    }),
  };

  const produced = producers[stepId]();
  return {
    ...produced,
    input_tokens: tokens.input,
    output_tokens: tokens.output,
    cost_usd: tokens.cost,
  };
}

/**
 * @param {string} guardrailId
 * @param {object} fixture
 * @param {object|null} review
 */
function runMockGuardrail(guardrailId, fixture, review) {
  const config = fixture.guardrails?.[guardrailId];

  if (guardrailId === 'G3') {
    const upheld = config?.challenge === 'UPHELD';
    const passed = upheld && config?.verdict_confirmed !== false;
    return {
      passed,
      agent: 'G3-adversarial-review',
      output: config ?? { challenge: 'UPHELD' },
      ref: 'guardrails/g3-result.json',
      input_tokens: fixture.tokens?.G3?.input ?? 0,
      output_tokens: fixture.tokens?.G3?.output ?? 0,
      cost_usd: fixture.tokens?.G3?.cost ?? 0,
    };
  }

  if (guardrailId === 'G4') {
    const reviewClean = review?.forbidden_patterns?.clean === true;
    const passed = config !== false && reviewClean;
    return {
      passed,
      agent: 'G4-verify-review-json',
      output: { match: passed },
      ref: 'guardrails/g4-result.json',
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
    };
  }

  const passed = config !== false;
  return {
    passed,
    agent: guardrailId === 'G1' ? 'G1-schema-validator' : 'G2-sql-sentinel',
    output: { passed },
    ref: `guardrails/${guardrailId.toLowerCase()}-result.json`,
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
  };
}

/**
 * @param {object} options
 * @returns {Promise<{ exitCode: number, state: object, logger: AuditLogger }>}
 */
export async function runWorkflow(options) {
  const fixture = FIXTURES[options.fixture];
  if (!fixture) {
    throw new Error(`Unknown fixture: ${options.fixture}`);
  }

  const runDir = resolve(DEV_ROOT, options.outputDir ?? join('artifacts', options.runId));
  mkdirSync(runDir, { recursive: true });

  const logger = new AuditLogger({
    runId: options.runId,
    auditDir: join(DEV_ROOT, 'audit-runs'),
  });

  let state = createInitialState();
  /** @type {number|null} S3 completion time (ms) for premature-approval mtime guard */
  let s3CompletedAt = null;
  const context = {
    triggerSql: fixture.trigger_sql,
    reviewAttempt: 0,
    remediateFailCount: options.remediateFailCount,
    forceFailReview: false,
    lastReview: null,
  };

  /** @param {object} fields */
  function logStep(fields) {
    return logger.append(fields);
  }

  /** @param {string} stepId @param {object} result @param {unknown} inputPayload */
  function logAgent(stepId, result, inputPayload) {
    const outputText =
      typeof result.output === 'string' ? result.output : JSON.stringify(result.output, null, 2);
    writeFileSync(join(runDir, result.ref), outputText, 'utf8');

    return logStep({
      step_id: stepId,
      step_type: 'agent',
      agent: result.agent,
      model: result.model,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      cost_usd: result.cost_usd,
      input_hash: AuditLogger.hash(inputPayload),
      output_hash: AuditLogger.hash(outputText),
      output_ref: join('artifacts', options.runId, result.ref).replace(/\\/g, '/'),
      status: 'success',
    });
  }

  /** @param {string} guardrailId @param {object} result @param {string} originStep @param {boolean} passed */
  function logGuardrail(guardrailId, result, originStep, passed) {
    return logStep({
      step_id: guardrailId,
      step_type: 'guardrail',
      agent: result.agent,
      model: 'mock:golden',
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      cost_usd: result.cost_usd,
      input_hash: AuditLogger.hash(originStep),
      output_hash: AuditLogger.hash(result.output),
      output_ref: join('artifacts', options.runId, result.ref).replace(/\\/g, '/'),
      status: passed ? 'success' : 'halted',
      failure_origin_step: passed ? undefined : originStep,
      detail: passed ? undefined : `Guardrail ${guardrailId} blocked handoff from ${originStep}`,
    });
  }

  /** @param {string} detail @param {string} [status] */
  function logRouting(detail, status = 'success') {
    return logStep({
      step_id: 'O',
      step_type: 'routing',
      agent: 'orchestrator',
      model: 'deterministic',
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
      input_hash: AuditLogger.hash(detail),
      output_hash: AuditLogger.hash(state),
      output_ref: '',
      status,
      detail,
      failure_origin_step: state.failureOriginStep ?? undefined,
    });
  }

  while (state.status === 'running' && state.nextStep) {
    const step = state.nextStep;

    if (step === 'S1' || step === 'S2' || step === 'S3' || step === 'S4') {
      const inputPayload =
        step === 'S1'
          ? fixture.brief
          : step === 'S2'
            ? fixture.requirements
            : step === 'S3'
              ? context.triggerSql
              : { review: context.lastReview, sql: context.triggerSql };

      const result = runMockAgent(step, fixture, context);

      if (step === 'S3') {
        context.lastReview = result.output;
        context.reviewAttempt += 1;
        s3CompletedAt = Date.now();
      }
      if (step === 'S4') {
        context.triggerSql = result.output;
      }

      logAgent(step, result, inputPayload);
      state = advanceLinear(state, step);

      if (step === 'S4') {
        state = onRemediateComplete(state);
        logRouting(`Remediate cycle ${state.remediateCycles}; next ${state.nextStep}`);
      }
      continue;
    }

    if (step === 'G1' || step === 'G2' || step === 'G3' || step === 'G4') {
      const originStep =
        step === 'G1' ? 'S1' : step === 'G2' ? 'S2' : 'S3';
      const guardResult = runMockGuardrail(step, fixture, context.lastReview);
      const passed = guardResult.passed;

      logGuardrail(step, guardResult, originStep, passed);
      state = onGuardrailResult(state, step, passed, originStep);

      if (!passed) {
        logRouting(state.reason ?? 'Guardrail halt', 'halted');
        break;
      }

      if (step === 'G3') {
        const verdict = context.lastReview?.verdict ?? 'FAIL';
        state = onPostG3Branch(state, verdict);
        logRouting(`Post-G3 branch on ${verdict}; next ${state.nextStep ?? 'terminal'}`);

        if (state.status === 'failure') {
          logRouting(state.reason ?? 'Retries exhausted', 'failure');
          break;
        }
        continue;
      }

      if (step === 'G4') {
        state = onReviewGuardrailsPassed(state);
        logRouting(`G4 passed; punch-out at ${state.nextStep}`);
        continue;
      }

      state = advanceLinear(state, step);
      continue;
    }

    if (step === 'P1') {
      const bypassAttempt = options.forceComplete || options.skipHuman;
      const sentinelPath = join(runDir, '.human-approved');
      let humanApproved = options.humanApproved;
      let prematureApproval = false;

      if (!humanApproved && !bypassAttempt && existsSync(sentinelPath)) {
        const sentinelMtime = statSync(sentinelPath).mtimeMs;
        if (s3CompletedAt !== null && sentinelMtime < s3CompletedAt) {
          prematureApproval = true;
        } else {
          humanApproved = true;
        }
      }

      state = onPunchOut(state, { humanApproved, bypassAttempt, prematureApproval });

      logStep({
        step_id: 'P1',
        step_type: 'punch-out',
        agent: 'deployment-sentinel',
        model: 'deterministic',
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        input_hash: AuditLogger.hash({ humanApproved, bypassAttempt, prematureApproval }),
        output_hash: AuditLogger.hash(state),
        output_ref: humanApproved
          ? join('artifacts', options.runId, '.human-approved').replace(/\\/g, '/')
          : '',
        status:
          state.status === 'success'
            ? 'success'
            : state.status === 'bypass_blocked'
              ? 'bypass_blocked'
              : state.status === 'premature_approval'
                ? 'premature_approval'
                : 'pending_human',
        detail: state.reason ?? undefined,
        failure_origin_step: state.failureOriginStep ?? undefined,
      });

      if (state.status === 'bypass_blocked') {
        logRouting('BYPASS_BLOCKED', 'bypass_blocked');
      } else if (state.status === 'premature_approval') {
        logRouting('PREMATURE_APPROVAL', 'premature_approval');
      } else if (state.status === 'pending_human') {
        logRouting('PENDING_HUMAN at P1', 'pending_human');
      } else {
        logRouting('Workflow success after human approval', 'success');
      }
      break;
    }

    throw new Error(`Unknown step: ${step}`);
  }

  const exitCode =
    state.status === 'success' ? 0 : state.status === 'pending_human' ? 2 : 1;

  return { exitCode, state, logger };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { exitCode, state } = await runWorkflow(options);
  console.log(JSON.stringify({ status: state.status, nextStep: state.nextStep, exitCode }, null, 2));
  process.exit(exitCode);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

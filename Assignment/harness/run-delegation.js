#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AuditLogger } from './lib/auditLogger.js';
import { executeDispatch } from './lib/dispatchRunner.js';
import { planNextGoldenDispatch } from './lib/goldenCoordinator.js';
import { createInitialState, onPunchOut, MAX_REMEDIATE_CYCLES } from './lib/router.js';
import { assembleFinalReport, buildDeterministicHeadings } from './lib/reportAssembler.js';
import { checkSubstanceGate } from './lib/substanceGate.js';
import { snapshotArtifactHashes, validApprovalTime } from './lib/examinationIntegrity.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSIGNMENT_ROOT = resolve(__dirname, '..');
const FIXTURES = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'golden.json'), 'utf8'));
const SUBSTANCE_OVERRIDES = join(ASSIGNMENT_ROOT, 'delegation', 'substance-overrides.jsonl');

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const options = {
    fixture: 'golden-pass',
    runId: `${new Date().toISOString().replace(/[:.]/g, '-')}-delegation`,
    correlationId: null,
    humanApproved: false,
    forceComplete: false,
    skipHuman: false,
    substanceContinue: false,
    outputDir: null,
    mode: 'golden',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--fixture' && argv[i + 1]) options.fixture = argv[++i];
    else if (arg === '--run-id' && argv[i + 1]) options.runId = argv[++i];
    else if (arg === '--correlation-id' && argv[i + 1]) options.correlationId = argv[++i];
    else if (arg === '--human-approved') options.humanApproved = true;
    else if (arg === '--substance-continue') options.substanceContinue = true;
    else if (arg === '--force-complete') options.forceComplete = true;
    else if (arg === '--skip-human') options.skipHuman = true;
    else if (arg === '--output-dir' && argv[i + 1]) options.outputDir = argv[++i];
    else if (arg === '--mode' && argv[i + 1]) options.mode = argv[++i];
  }

  if (!options.correlationId) {
    options.correlationId = options.runId;
  }

  return options;
}

/**
 * @param {object} options
 */
export async function runDelegation(options) {
  if (options.mode && options.mode !== 'golden') {
    throw new Error('This runner replays golden fixtures only. A hosted LLM coordinator run is separate evidence; --mode cannot turn fixtures into inference.');
  }
  options = { ...options, correlationId: options.correlationId ?? options.runId };
  const fixture = FIXTURES[options.fixture];
  if (!fixture) {
    throw new Error(`Unknown fixture: ${options.fixture}`);
  }

  const auditDir = options.auditDir ?? join(ASSIGNMENT_ROOT, '..', 'audit-runs');
  const runDir = options.outputDir ?? join(ASSIGNMENT_ROOT, 'artifacts', options.runId);
  mkdirSync(runDir, { recursive: true });

  const logger = new AuditLogger({ runId: options.runId, auditDir });
  const state = createInitialState();
  state.status = 'running';

  /** @type {object} */
  const context = {
    reviewAttempt: 0,
    requirements: null,
    triggerSql: null,
    lastReview: null,
    adversarialResult: null,
    g4Passed: false,
    reportBody: null,
    w5SessionId: null,
  };

  /** @param {object} fields */
  function logStep(fields) {
    return logger.append({
      correlation_id: options.correlationId,
      usage_source: 'simulated',
      execution_mode: 'golden',
      ...fields,
    });
  }

  const maxIterations = 40;
  for (let i = 0; i < maxIterations; i += 1) {
    const tool = planNextGoldenDispatch(state, context);
    if (!tool) {
      break;
    }

    logStep({
      step_id: 'C',
      step_type: 'coordinator',
      agent: 'coordinator',
      model: 'mock:golden-coordinator',
      input_tokens: 120,
      output_tokens: 40,
      cost_usd: 0.0008,
      input_hash: AuditLogger.hash({ tool, iteration: i }),
      output_hash: AuditLogger.hash(tool),
      output_ref: '',
      status: 'success',
      detail: `dispatch ${tool}`,
    });

    const dispatchInput = { tool, requirements: context.requirements, triggerSql: context.triggerSql, lastReview: context.lastReview, challenges: context.challenges };
    const { agentResult, validationError } = executeDispatch({
      tool,
      fixture,
      context,
      runDir,
    });

    // Failed boundary checks still consumed an agent invocation and belong in the audit.
    logStep({
      step_id: agentResult.workflow,
      step_type: 'agent',
      agent: agentResult.agent,
      model: agentResult.model,
      input_tokens: agentResult.input_tokens,
      output_tokens: agentResult.output_tokens,
      cost_usd: agentResult.cost_usd,
      input_hash: AuditLogger.hash(dispatchInput),
      output_hash: AuditLogger.hash(agentResult.output ?? null),
      output_ref: agentResult.output === undefined ? '' : join(runDir, agentResult.ref).replace(/\\/g, '/'),
      status: validationError ? 'validation_failed' : 'success',
      detail: agentResult.isolated_session_id ? `simulated_isolated_session_id=${agentResult.isolated_session_id}` : undefined,
    });

    if (validationError) {
      logStep({
        step_id: validationError.guardrail ?? 'VALIDATION',
        step_type: 'guardrail',
        agent: validationError.guardrail ?? 'validation',
        model: 'deterministic',
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        input_hash: AuditLogger.hash(tool),
        output_hash: AuditLogger.hash(validationError),
        output_ref: '',
        status: 'halted',
        detail: validationError.findings?.join('; '),
        failure_origin_step:
          validationError.guardrail === 'G4'
            ? 'S3'
            : validationError.guardrail === 'G1'
              ? 'S1'
              : agentResult.workflow,
      });
      state.status = 'halted';
      state.reason = validationError.findings?.join('; ') ?? 'Validation failed';
      state.failureOriginStep = agentResult.workflow;
      break;
    }

    if (tool === 'launch_remediator') {
      state.remediateCycles += 1;
      if (state.remediateCycles > MAX_REMEDIATE_CYCLES) {
        state.status = 'failure';
        state.reason = 'Remediate cycles exceeded';
        break;
      }
    }
  }

  if (state.status === 'running' && context.reportBody) {
    const headings = buildDeterministicHeadings({
      artifacts: [
        { id: 'trigger.sql', verdict: context.lastReview?.verdict === 'PASS' ? 'PASS' : 'FAIL' },
        { id: 'review.json', verdict: context.lastReview?.verdict === 'PASS' ? 'PASS' : 'FAIL' },
      ],
    });
    const report = assembleFinalReport(headings, context.reportBody);
    writeFileSync(join(runDir, 'delivery-report.md'), report, 'utf8');
    context.reportHash = AuditLogger.hash(report);
    context.examination = {
      run_id: options.runId, correlation_id: options.correlationId,
      execution_mode: 'golden', report_hash: context.reportHash,
      created_at: new Date().toISOString(), audit_dir: resolve(auditDir),
      artifact_hashes: snapshotArtifactHashes(runDir),
    };
    writeFileSync(join(runDir, 'examination.json'), JSON.stringify(context.examination, null, 2), 'utf8');

    const substance = checkSubstanceGate(
      options.substanceOverridesPath ?? SUBSTANCE_OVERRIDES,
      options.correlationId,
      { reportHash: context.reportHash },
    );
    if (substance.blocked) {
      state.status = substance.decision?.decision === 'Reject' ? 'failure' : 'pending_human';
      state.reason = substance.reason;
      logStep({
        step_id: 'S-substance',
        step_type: 'punch-out',
        agent: 'substance-gate',
        model: 'deterministic',
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        input_hash: AuditLogger.hash(options.correlationId),
        output_hash: AuditLogger.hash(substance),
        output_ref: '',
        status: substance.decision?.decision === 'Reject' ? 'rejected' : 'pending_human',
        detail: substance.reason,
      });
    }
  }

  if (state.status === 'running' && context.reportBody && !state.reason?.includes('SUBSTANCE')) {
    const bypassAttempt = options.forceComplete || options.skipHuman || options.humanApproved;
    const sentinelPath = join(runDir, '.human-approved');
    let humanApproved = false;
    let prematureApproval = false;

    if (!bypassAttempt && existsSync(sentinelPath)) {
      try {
        const approval = JSON.parse(readFileSync(sentinelPath, 'utf8'));
        humanApproved = approval.decision === 'Approve'
          && typeof approval.reviewer === 'string' && approval.reviewer.trim().length > 0
          && approval.correlation_id === options.correlationId
          && approval.report_hash === context.reportHash
          && validApprovalTime(approval.timestamp, context.examination);
        prematureApproval = !humanApproved;
      } catch { prematureApproval = true; }
    }

    const punchState = onPunchOut(state, { humanApproved, bypassAttempt, prematureApproval });
    Object.assign(state, punchState);

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
      output_ref: humanApproved ? sentinelPath.replace(/\\/g, '/') : '',
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
  }

  if (state.status === 'running' && !context.reportBody) {
    if (state.status === 'running') {
      state.status = context.lastReview?.verdict === 'FAIL' ? 'failure' : 'halted';
    }
  }

  const exitCode =
    state.status === 'success' ? 0 : state.status === 'pending_human' ? 2 : 1;

  return { exitCode, state, logger, correlationId: options.correlationId, runDir, reportHash: context.reportHash };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { exitCode, state, correlationId } = await runDelegation(options);
  console.log(JSON.stringify({ status: state.status, correlationId, exitCode }, null, 2));
  process.exit(exitCode);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

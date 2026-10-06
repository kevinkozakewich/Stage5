import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuditLogger } from './auditLogger.js';
import { validateAtBoundary } from './dispatchRunner.js';
import { DISPATCH_TOOL_NAMES } from './coordinatorSchema.js';
import { assembleFinalReport, buildDeterministicHeadings } from './reportAssembler.js';
import { checkSubstanceGate } from './substanceGate.js';
import { snapshotArtifactHashes } from './examinationIntegrity.js';
import { verifyReviewJson } from '../../guardrails/verify-review-json.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOWS = {
  launch_spec_parser: { id: 'W1', name: 'spec-parser', directory: 'w1-spec-parse', artifact: 'requirements.json' },
  launch_trigger_codegen: { id: 'W2', name: 'trigger-codegen', directory: 'w2-trigger-codegen', artifact: 'trigger.sql' },
  launch_trigger_review: { id: 'W3', name: 'trigger-review', directory: 'w3-trigger-review', artifact: 'review.json' },
  launch_remediator: { id: 'W4', name: 'remediator', directory: 'w4-remediator', artifact: 'trigger.sql' },
  launch_adversarial_reviewer: { id: 'W5', name: 'adversarial-review', directory: 'w5-adversarial-review', artifact: 'adversarial.json' },
  launch_delivery_report_writer: { id: 'W6', name: 'delivery-report', directory: 'w6-delivery-report', artifact: 'report-body.md' },
};
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const clone = (value) => structuredClone(value);
const stringify = (value) => typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2);
const jsonOutput = (output) => typeof output === 'string' ? JSON.parse(output) : output;
const errorResult = (guardrail, findings) => ({ ok: false, code: 'VALIDATION_ERROR', guardrail, findings });

/** Validate a provider-neutral usage record without inventing missing prices. */
export function normalizeGovernedUsage(usage) {
  if (!object(usage) || !text(usage.model)) throw new Error('A provider-reported model identity is required');
  for (const field of ['input_tokens', 'output_tokens']) {
    if (!Number.isInteger(usage[field]) || usage[field] < 0) throw new Error(`${field} must be a measured non-negative integer`);
  }
  const cost = object(usage.cost) ? clone(usage.cost) : { usd: usage.cost_usd ?? null, status: usage.cost_usd == null ? 'not_reported' : 'reported' };
  if (cost.usd !== null && (typeof cost.usd !== 'number' || !Number.isFinite(cost.usd) || cost.usd < 0)) throw new Error('Reported USD cost must be non-negative or null');
  if (cost.usd === null && cost.status !== 'not_reported') throw new Error('Unavailable cost must explicitly be not_reported');
  return { ...clone(usage), cost, cost_usd: cost.usd, cost_status: cost.status, usage_source: usage.usage_source ?? 'provider_reported' };
}

/**
 * Custom application harness. Inference is supplied through request/response
 * callbacks; this module never launches an agentic CLI, shell, or model vendor.
 * The application coordinator receives ONLY the six declared dispatch tools.
 * Evaluation transports may run in a broader host, which is not represented as
 * a sandboxed application runtime. All executable application capabilities live here.
 */
export function createGovernedSession(options) {
  if (!text(options?.brief) || !text(options.runId)) throw new Error('brief and runId are required');
  const runDir = resolve(options.runDir ?? join(ROOT, 'artifacts', options.runId));
  const auditDir = resolve(options.auditDir ?? join(runDir, 'audit'));
  const correlationId = options.correlationId ?? options.runId;
  const executionMode = options.executionMode ?? 'governed';
  const maxRequests = options.maxRequests ?? 80;
  const maxRemediations = options.maxRemediations ?? 3;
  mkdirSync(runDir, { recursive: true });
  if (existsSync(join(runDir, 'governed-session.json'))) throw new Error('Run already exists; use a new run ID/directory to preserve immutable evidence');
  const logger = new AuditLogger({ runId: options.runId, auditDir });
  if (logger.getEntries().length) throw new Error('Audit run ID already exists; use a fresh run ID');
  const schema = JSON.parse(readFileSync(join(ROOT, 'coordinator/tools/schema.json'), 'utf8'));
  const declaredTools = schema.tools;
  if (!Array.isArray(declaredTools) || declaredTools.length !== DISPATCH_TOOL_NAMES.length
    || new Set(declaredTools.map((tool) => tool.name)).size !== DISPATCH_TOOL_NAMES.length
    || declaredTools.some((tool) => !DISPATCH_TOOL_NAMES.includes(tool.name))) throw new Error('Coordinator schema must declare exactly the six application dispatch tools');
  const state = {
    schema_version: 1, run_id: options.runId, correlation_id: correlationId, execution_mode: executionMode,
    status: 'running', reason: null, created_at: new Date().toISOString(), request_count: 0, dispatch_count: 0,
    remediations: 0, artifacts: [], current: {}, reviews: [], events: [], dispositions: [], pending: null,
  };
  writeFileSync(join(runDir, 'brief.md'), options.brief, { flag: 'wx' });
  const briefHash = AuditLogger.hash(options.brief);

  function persist() { writeFileSync(join(runDir, 'governed-session.json'), JSON.stringify(state, null, 2)); }
  function snapshot() { return clone({ ...state, run_dir: runDir, audit_path: logger.logPath }); }
  function artifact(id) { return state.artifacts.find((entry) => entry.id === id); }
  function current(name) { return artifact(state.current[name]); }
  function latestReview(id) { return state.reviews.filter((review) => review.artifact_id === id).at(-1); }
  function allCurrent() { return Object.values(state.current).map(artifact).filter(Boolean); }
  function summaries(entries = state.artifacts) {
    return entries.map((entry) => ({
      artifact_id: entry.id, workflow_id: entry.workflow_id, canonical_name: entry.canonical_name,
      hash: entry.hash, current: state.current[entry.canonical_name] === entry.id,
      output: clone(entry.output), source_artifacts: clone(entry.source_artifacts),
      review: clone(latestReview(entry.id) ?? null),
    }));
  }
  function missingReviews() { return state.artifacts.filter((entry) => !latestReview(entry.id)).map((entry) => entry.id); }
  function currentChallenges() {
    return allCurrent().flatMap((entry) => latestReview(entry.id)?.output.findings ?? []);
  }
  function findingHistory() {
    const examinationFindings = state.artifacts.filter((entry) => entry.workflow_id === 'W3').flatMap((entry) =>
      (entry.output.violations ?? []).map((finding) => ({ ...clone(finding), artifact: entry.id, target_artifact_id: entry.id, origin: 'examiner' })));
    return [...examinationFindings, ...state.reviews.flatMap((review) => (review.output.findings ?? []).map((finding) => ({ ...clone(finding), review_id: review.id, target_artifact_id: review.artifact_id, origin: 'adversarial' })))];
  }
  function emitAudit(request, output, usage, fields) {
    return logger.append({
      correlation_id: correlationId, execution_mode: executionMode,
      step_id: request.role === 'coordinator' ? 'C' : request.workflowId,
      step_type: request.role === 'coordinator' ? 'coordinator' : 'agent',
      agent: request.role === 'coordinator' ? 'coordinator' : WORKFLOWS[request.dispatch.name].name,
      ...usage, request_id: request.requestId, isolated_context: request.isolated_context ?? false,
      isolated_session_id: request.sessionId, declared_tools: request.tools.map((tool) => tool.name),
      input_hash: AuditLogger.hash(request), output_hash: AuditLogger.hash(output), ...fields,
    });
  }
  function recordError(request, result) {
    state.events.push({ request_id: request.requestId, tool: request.dispatch?.name ?? 'coordinator', result: clone(result) });
    logger.append({ correlation_id: correlationId, execution_mode: executionMode, step_id: result.guardrail,
      step_type: 'guardrail', agent: 'boundary-validator', model: 'deterministic', input_tokens: 0,
      output_tokens: 0, cost_usd: 0, usage_source: 'not_applicable', status: 'validation_failed',
      input_hash: AuditLogger.hash(request.requestId), output_hash: AuditLogger.hash(result), detail: result.findings.join('; ') });
  }
  function baseRequest(role, fields) {
    state.request_count += 1;
    const request = { requestId: `${options.runId}-${String(state.request_count).padStart(3, '0')}`, role,
      correlationId, executionMode, ...fields,
      implementation: {
        harness_sha256: AuditLogger.hash(readFileSync(fileURLToPath(import.meta.url))),
        prompt_sha256: AuditLogger.hash(fields.prompt),
        coordinator_schema_sha256: AuditLogger.hash(readFileSync(join(ROOT, 'coordinator/tools/schema.json'))),
        ...(fields.implementation ?? {}),
      },
    };
    mkdirSync(join(runDir, 'requests'), { recursive: true });
    writeFileSync(join(runDir, 'requests', `${request.requestId}.json`), JSON.stringify(request, null, 2), { flag: 'wx' });
    state.pending = request;
    persist();
    return clone(request);
  }
  function coordinatorRequest() {
    return baseRequest('coordinator', {
      prompt: readFileSync(join(ROOT, 'coordinator/prompt/Prompt.md'), 'utf8'),
      tools: clone(declaredTools),
      context: {
        brief: options.brief, brief_ref: 'brief.md', artifacts: summaries(),
        required_reviews: missingReviews(), current_artifact_ids: clone(state.current),
        challenges: currentChallenges(), challenge_history: findingHistory(),
        coordinator_dispositions: clone(state.dispositions), last_results: clone(state.events.slice(-8)),
        remediations_used: state.remediations, max_remediations: maxRemediations,
        human_checkpoints: { substance: 'not_approved', deployment: 'not_approved' },
        response_contract: { name: 'one of the six declared launch tools', arguments: 'tool schema object', disposition: 'nonempty reasoning for this dispatch' },
        completion_rule: 'Dispatch independent W5 review of every immutable worker artifact. After all current artifacts and W6 are upheld, the harness creates the report and waits for a human.',
      },
    });
  }
  function validateDispatch(call) {
    if (!object(call) || Object.keys(call).some((key) => !['name', 'arguments', 'disposition'].includes(key))
      || !DISPATCH_TOOL_NAMES.includes(call.name) || !object(call.arguments) || !text(call.disposition)) {
      return errorResult('DISPATCH', ['Return exactly {name, arguments, disposition} using a declared dispatch tool and nonempty reasoning']);
    }
    const tool = declaredTools.find((entry) => entry.name === call.name);
    const parameters = tool.parameters ?? {};
    const properties = parameters.properties ?? {};
    const findings = [];
    for (const name of parameters.required ?? []) if (!(name in call.arguments)) findings.push(`Missing required dispatch argument ${name}`);
    for (const [name, value] of Object.entries(call.arguments)) {
      const field = properties[name];
      if (!field) { findings.push(`Undeclared dispatch argument ${name}`); continue; }
      if (field.type === 'string' && !text(value)) findings.push(`${name} must be nonempty text`);
      if (field.type === 'array' && !Array.isArray(value)) findings.push(`${name} must be an array`);
      if (field.type === 'object' && !object(value)) findings.push(`${name} must be an object`);
      if (field.enum && !field.enum.includes(value)) findings.push(`${name} is outside its permitted values`);
    }
    if (call.arguments.target_step !== WORKFLOWS[call.name].id) findings.push('target_step must identify the dispatched workflow');
    if (call.arguments.brief_ref && call.arguments.brief_ref !== 'brief.md') findings.push('Only the supplied brief.md can be dispatched');
    if (findings.length) return errorResult('DISPATCH', findings);
    const name = call.name;
    if (['launch_trigger_codegen', 'launch_trigger_review', 'launch_remediator'].includes(name) && !current('requirements.json')) findings.push('Validated requirements are required');
    if (['launch_trigger_review', 'launch_remediator'].includes(name) && !current('trigger.sql')) findings.push('A validated trigger is required');
    const requiredUpheld = name === 'launch_trigger_codegen' || name === 'launch_remediator' ? ['requirements.json']
      : name === 'launch_trigger_review' ? ['requirements.json', 'trigger.sql'] : [];
    for (const prerequisite of requiredUpheld) {
      const entry = current(prerequisite);
      if (entry && latestReview(entry.id)?.output.challenge !== 'UPHELD') findings.push(`Independent UPHELD review is required for prerequisite ${entry.id}`);
    }
    if (name === 'launch_remediator') {
      if (!current('review.json') && currentChallenges().length === 0) findings.push('Remediation requires an examiner result or an adversarial challenge');
      if (state.remediations >= maxRemediations) findings.push('The remediation budget is exhausted');
    }
    if (name === 'launch_adversarial_reviewer') {
      if (!text(call.arguments.artifact_id) || !artifact(call.arguments.artifact_id)) findings.push('artifact_id must identify an immutable validated worker output');
    }
    if (name === 'launch_delivery_report_writer') {
      if (!current('requirements.json') || !current('trigger.sql') || !current('review.json')) findings.push('Requirements, trigger, and examiner output must exist before synthesis');
      const missing = missingReviews().filter((id) => artifact(id).workflow_id !== 'W6');
      if (missing.length) findings.push(`Independent review is required for: ${missing.join(', ')}`);
      const challenged = allCurrent().filter((entry) => entry.workflow_id !== 'W6' && latestReview(entry.id)?.output.challenge !== 'UPHELD');
      if (challenged.length) findings.push(`Current artifact reviews are not upheld: ${challenged.map((entry) => entry.id).join(', ')}`);
      if (current('review.json')?.output.verdict !== 'PASS') findings.push('The current examiner verdict must PASS before delivery synthesis');
    }
    if (call.arguments.artifact_focus && !artifact(call.arguments.artifact_focus)
      && !Object.keys(state.current).includes(call.arguments.artifact_focus)) findings.push('artifact_focus must identify an existing assigned artifact');
    return findings.length ? errorResult('PREREQUISITE', findings) : null;
  }
  function sourceEntries(workflow) {
    const names = workflow.id === 'W1' ? [] : workflow.id === 'W2' ? ['requirements.json']
      : workflow.id === 'W3' ? ['requirements.json', 'trigger.sql']
        : workflow.id === 'W4' ? ['requirements.json', 'trigger.sql', 'review.json'] : Object.keys(state.current);
    return names.map(current).filter(Boolean);
  }
  function workflowRequest(call) {
    if (state.request_count >= maxRequests) {
      state.status = 'halted'; state.reason = 'Inference request budget exhausted'; persist(); return null;
    }
    const workflow = WORKFLOWS[call.name];
    const manifest = JSON.parse(readFileSync(join(ROOT, 'workflows', workflow.directory, 'manifest.json'), 'utf8'));
    if (workflow.id === 'W5' && manifest.isolated_context !== true) throw new Error('W5 requires an explicitly isolated context');
    const sources = sourceEntries(workflow).filter((entry) => entry.workflow_id !== 'W6');
    const target = workflow.id === 'W5' ? artifact(call.arguments.artifact_id) : null;
    const targetSources = target ? target.source_artifacts.map(artifact).filter(Boolean) : [];
    const relatedReviews = target ? state.reviews.filter((entry) => [target.id, ...target.source_artifacts].includes(entry.artifact_id)) : [];
    const allowed = target ? ['brief.md', target.id, ...targetSources.map((entry) => entry.id), ...relatedReviews.map((entry) => entry.id),
      ...(target.workflow_id === 'W6' ? [...state.artifacts.map((entry) => entry.id), ...state.reviews.map((entry) => entry.id)] : [])] : [];
    const targetedChallenges = currentChallenges().filter((finding) => !call.arguments.artifact_focus || finding.artifact === call.arguments.artifact_focus || artifact(finding.artifact)?.canonical_name === call.arguments.artifact_focus);
    const context = workflow.id === 'W1' ? { brief: options.brief, challenges: targetedChallenges, artifact_focus: call.arguments.artifact_focus ?? null }
      : workflow.id === 'W5' ? {
        target: summaries([target])[0], original_verdict: target.output?.verdict ?? 'PASS',
        sources: summaries(targetSources), source_reviews: clone(relatedReviews), brief: options.brief,
        allowed_files: [...new Set(allowed)],
        coordinator_disposition: call.disposition, challenge_history: findingHistory().filter((finding) => finding.target_artifact_id === target.id),
        ...(target.workflow_id === 'W6' ? { moderated_bundle: clone(target.synthesis_context) } : {}),
      } : {
        artifacts: summaries(sources),
        requirements: clone(current('requirements.json')?.output ?? null),
        ...(workflow.id !== 'W2' ? { trigger_sql: current('trigger.sql')?.output ?? null } : {}),
        ...(['W4', 'W6'].includes(workflow.id) ? { examination: clone(current('review.json')?.output ?? null) } : {}),
        coordinator_disposition: call.disposition,
        challenges: targetedChallenges, artifact_focus: call.arguments.artifact_focus ?? null,
        ...(workflow.id === 'W4' ? { challenges: currentChallenges(), challenge_history: findingHistory(), target_artifact_id: call.arguments.artifact_focus ?? state.current['trigger.sql'] } : {}),
        ...(workflow.id === 'W6' ? { all_outputs: summaries(), reviews: clone(state.reviews),
          finding_history: findingHistory(), coordinator_dispositions: clone(state.dispositions),
          current_artifact_ids: sources.map((entry) => entry.id), required_finding_ids: [...new Set(findingHistory().map((finding) => finding.id).filter(Boolean))],
          human_checkpoint_status: 'Pending; no deployment approval or substance Continue has been granted' } : {}),
      };
    const tools = workflow.id === 'W5' ? [{ name: 'read_file', description: 'Read an immutable artifact or original brief assigned to this independent review',
      parameters: { type: 'object', additionalProperties: false, required: ['path'], properties: { path: { type: 'string', enum: context.allowed_files } } } }] : [];
    if (JSON.stringify([...(manifest.allowed_tools ?? [])].sort()) !== JSON.stringify(tools.map((tool) => tool.name).sort())) throw new Error(`Workflow ${workflow.id} manifest differs from its enforced tools`);
    return baseRequest('workflow', { workflowId: workflow.id, dispatch: clone(call),
      prompt: readFileSync(join(ROOT, manifest.agent_path, 'prompt/Prompt.md'), 'utf8'),
      implementation: { manifest_sha256: AuditLogger.hash(readFileSync(join(ROOT, 'workflows', workflow.directory, 'manifest.json'))) },
      context, tools, isolated_context: manifest.isolated_context === true,
      sessionId: randomUUID(), tool_results: [], source_artifacts: sources.map((entry) => entry.id),
    });
  }
  function persistOutput(request, output, suffix = '') {
    state.dispatch_count += 1;
    const workflow = request.role === 'workflow' ? WORKFLOWS[request.dispatch.name] : null;
    const file = `${String(state.dispatch_count).padStart(3, '0')}-${suffix || workflow?.artifact || 'coordinator.json'}`;
    writeFileSync(join(runDir, file), stringify(output), { flag: 'wx' });
    return file;
  }
  function invalidate(name) {
    if (name === 'requirements.json') delete state.current['trigger.sql'];
    if (['requirements.json', 'trigger.sql'].includes(name)) delete state.current['review.json'];
    if (['requirements.json', 'trigger.sql', 'review.json'].includes(name)) delete state.current['report-body.md'];
  }
  function validateWorker(request, output) {
    const validation = validateAtBoundary(request.dispatch.name, { output }, {}, {});
    if (!validation.ok) return validation;
    const findings = [];
    if (request.workflowId === 'W5') {
      const target = artifact(request.dispatch.arguments.artifact_id);
      if (output.artifact_id !== target.id || output.workflow_id !== target.workflow_id) findings.push('Review identity must match the assigned immutable artifact and workflow');
      if (output.original_verdict !== (target.output?.verdict ?? 'PASS')) findings.push('original_verdict must preserve the assigned artifact verdict');
      const allowed = request.context.allowed_files;
      for (const finding of output.findings ?? []) {
        if (!text(finding.id) || !text(finding.artifact) || !allowed.includes(finding.artifact)) findings.push('Each finding requires an ID and an assigned immutable evidence artifact');
      }
      if (output.challenge === 'UPHELD' && output.findings.length) findings.push('An UPHELD review cannot contain unresolved findings');
      if (target.workflow_id === 'W3' && output.challenge === 'UPHELD') {
        const sql = target.source_artifacts.map(artifact).find((entry) => entry?.canonical_name === 'trigger.sql');
        const crosscheck = verifyReviewJson(target.output, sql?.output ?? '');
        if (!crosscheck.pass) findings.push(...crosscheck.findings);
      }
    }
    if (request.workflowId === 'W6') {
      if (output.trim().split(/\n\s*\n/).length > 3) findings.push('Report body must contain at most three paragraphs');
      for (const id of [...request.context.current_artifact_ids, ...request.context.required_finding_ids]) {
        if (!output.includes(id)) findings.push(`Report must synthesize moderated artifact/finding ${id}`);
      }
    }
    return findings.length ? errorResult(request.workflowId, findings) : null;
  }
  function finishIfComplete() {
    const report = current('report-body.md');
    if (!report || latestReview(report.id)?.output.challenge !== 'UPHELD' || missingReviews().length) return;
    if (allCurrent().some((entry) => latestReview(entry.id)?.output.challenge !== 'UPHELD')) return;
    if (current('review.json')?.output.verdict !== 'PASS') return;
    for (const entry of state.artifacts) {
      if (AuditLogger.hash(readFileSync(join(runDir, entry.id), 'utf8')) !== entry.hash) throw new Error(`Immutable artifact changed: ${entry.id}`);
    }
    for (const entry of allCurrent()) {
      if (AuditLogger.hash(readFileSync(join(runDir, entry.canonical_name), 'utf8')) !== entry.hash) throw new Error(`Current artifact changed: ${entry.canonical_name}`);
    }
    const headings = buildDeterministicHeadings({ artifacts: allCurrent().filter((entry) => entry.workflow_id !== 'W6').map((entry) => ({ id: entry.id, verdict: latestReview(entry.id).output.recommended_verdict })) });
    const completeReport = assembleFinalReport(headings, report.output);
    writeFileSync(join(runDir, 'delivery-report.md'), completeReport, { flag: 'wx' });
    const reportHash = AuditLogger.hash(completeReport);
    const examination = { run_id: options.runId, correlation_id: correlationId, execution_mode: executionMode,
      report_hash: reportHash, created_at: new Date().toISOString(), audit_dir: auditDir,
      artifact_hashes: snapshotArtifactHashes(runDir), reviewed_artifacts: state.artifacts.map((entry) => ({ artifact_id: entry.id, hash: entry.hash, review_id: latestReview(entry.id).id })),
      application_coordinator_tools: declaredTools.map((tool) => tool.name),
    };
    writeFileSync(join(runDir, 'examination.json'), JSON.stringify(examination, null, 2), { flag: 'wx' });
    const substance = checkSubstanceGate(options.substanceOverridesPath ?? join(ROOT, 'delegation/substance-overrides.jsonl'), correlationId, { reportHash });
    state.status = substance.decision?.decision === 'Reject' ? 'rejected' : 'pending_human';
    state.reason = substance.blocked ? substance.reason : 'DEPLOYMENT_CHECKPOINT — an identified human must approve the unchanged report';
    state.report_hash = reportHash;
    logger.append({ correlation_id: correlationId, execution_mode: executionMode, step_id: 'P1', step_type: 'punch-out', agent: 'human-checkpoint',
      model: 'deterministic', input_tokens: 0, output_tokens: 0, cost_usd: 0, usage_source: 'not_applicable',
      input_hash: reportHash, output_hash: AuditLogger.hash({ status: state.status, reason: state.reason }),
      output_ref: join(runDir, 'delivery-report.md'), status: state.status, detail: state.reason });
  }

  async function nextRequest() {
    if (state.pending) return clone(state.pending);
    if (state.status !== 'running') return null;
    if (state.request_count >= maxRequests) {
      state.status = 'halted'; state.reason = 'Inference request budget exhausted'; persist(); return null;
    }
    return coordinatorRequest();
  }
  async function submitResponse({ requestId, output: rawOutput, usage: rawUsage }) {
    const request = state.pending;
    if (!request || request.requestId !== requestId) throw new Error('Response does not match the outstanding inference request');
    const usage = normalizeGovernedUsage(rawUsage);
    mkdirSync(join(runDir, 'responses'), { recursive: true });
    writeFileSync(join(runDir, 'responses', `${requestId}.json`), JSON.stringify({ requestId, output: rawOutput ?? null, usage }, null, 2), { flag: 'wx' });
    state.pending = null;
    let output = rawOutput;
    if (request.role === 'coordinator' || ['W1', 'W3', 'W5'].includes(request.workflowId)) {
      try { output = jsonOutput(rawOutput); }
      catch {
        const ref = persistOutput(request, rawOutput, 'invalid-response.txt');
        const failure = errorResult(request.role === 'coordinator' ? 'DISPATCH' : request.workflowId, ['Output must be parseable JSON']);
        emitAudit(request, rawOutput, usage, { status: 'validation_failed', output_ref: join(runDir, ref) }); recordError(request, failure); persist(); return clone(failure);
      }
    }
    if (request.role === 'coordinator') {
      const failure = validateDispatch(output);
      const ref = persistOutput(request, output, 'coordinator.json');
      emitAudit(request, output, usage, { status: failure ? 'validation_failed' : 'success', output_ref: join(runDir, ref) });
      if (failure) { recordError(request, failure); persist(); return clone(failure); }
      state.dispositions.push({ request_id: requestId, name: output.name, arguments: clone(output.arguments), disposition: output.disposition });
      workflowRequest(output);
      return { ok: true, dispatched: output.name };
    }
    if (object(output) && 'name' in output && 'arguments' in output) {
      let result;
      const path = output.arguments?.path;
      if (request.workflowId !== 'W5' || output.name !== 'read_file' || !object(output.arguments)
        || Object.keys(output.arguments).some((key) => key !== 'path') || !request.context.allowed_files.includes(path)) {
        result = errorResult('TOOL_SCOPE', ['This workflow can only read its explicitly assigned immutable artifacts']);
      } else {
        try {
          const full = resolve(runDir, path);
          const rel = relative(realpathSync(runDir), realpathSync(full));
          if (isAbsolute(path) || rel.startsWith('..') || isAbsolute(rel)) result = errorResult('TOOL_SCOPE', ['Read escaped its assigned artifact directory']);
          else {
            const contents = readFileSync(full, 'utf8');
            const expected = path === 'brief.md' ? briefHash : artifact(path)?.hash ?? state.reviews.find((entry) => entry.id === path)?.hash;
            result = AuditLogger.hash(contents) === expected ? { ok: true, path, content: contents, hash: expected }
              : errorResult('ARTIFACT_INTEGRITY', ['Assigned artifact changed after production']);
          }
        } catch { result = errorResult('READ_ERROR', ['Assigned artifact is unavailable; no substitute source was read']); }
      }
      const ref = persistOutput(request, output, 'worker-tool-call.json');
      emitAudit(request, output, usage, { status: result.ok ? 'tool_call' : 'validation_failed', output_ref: join(runDir, ref) });
      const { requestId: oldId, role, ...continuation } = request;
      continuation.tool_results = [...request.tool_results, { call: clone(output), result }];
      if (state.request_count >= maxRequests) { state.status = 'halted'; state.reason = 'Inference request budget exhausted'; }
      else baseRequest(role, continuation);
      persist(); return clone(result);
    }
    const ref = persistOutput(request, output);
    const failure = validateWorker(request, output);
    emitAudit(request, output, usage, { status: failure ? 'validation_failed' : 'success', output_ref: join(runDir, ref) });
    if (failure) { recordError(request, failure); persist(); return clone(failure); }
    const workflow = WORKFLOWS[request.dispatch.name];
    writeFileSync(join(runDir, workflow.artifact), stringify(output));
    if (workflow.id === 'W5') {
      state.reviews.push({ id: ref, artifact_id: request.dispatch.arguments.artifact_id, hash: AuditLogger.hash(stringify(output)),
        isolated_context: request.isolated_context, isolated_session_id: request.sessionId,
        source_artifacts: clone(request.context.allowed_files), output: clone(output) });
    } else {
      const entry = { id: ref, canonical_name: workflow.artifact, workflow_id: workflow.id,
        hash: AuditLogger.hash(stringify(output)), output: clone(output), source_artifacts: clone(request.source_artifacts),
        ...(workflow.id === 'W6' ? { synthesis_context: clone(request.context) } : {}) };
      invalidate(workflow.artifact);
      state.artifacts.push(entry);
      state.current[workflow.artifact] = ref;
      if (workflow.id === 'W4') state.remediations += 1;
    }
    state.events.push({ request_id: requestId, tool: request.dispatch.name, result: { ok: true, artifact_id: ref, output: clone(output) } });
    finishIfComplete(); persist();
    return { ok: true, artifact_id: ref, status: state.status };
  }
  persist();
  return Object.freeze({ nextRequest, submitResponse, snapshot, runDir, auditPath: logger.logPath });
}

/** Optional direct callback integration for an API or a hosted application adapter. */
export async function runGovernedDelegation(options) {
  const { inferCoordinator, inferWorkflow } = options;
  if (typeof inferCoordinator !== 'function' || typeof inferWorkflow !== 'function') throw new Error('Both inference callbacks are required');
  const session = createGovernedSession(options);
  for (let request = await session.nextRequest(); request; request = await session.nextRequest()) {
    const response = await (request.role === 'coordinator' ? inferCoordinator : inferWorkflow)(clone(request));
    await session.submitResponse({ requestId: request.requestId, ...response });
  }
  return session.snapshot();
}

/** Recompute readiness from packaged evidence. Never reads a user's host logs. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DISPATCH_TOOL_NAMES } from '../harness/lib/coordinatorSchema.js';
import { AuditLogger } from '../harness/lib/auditLogger.js';
import { validateAdversarialJson } from '../guardrails/validate-adversarial-json.js';
import { buildDeterministicHeadings, assembleFinalReport, validateReportBody } from '../harness/lib/reportAssembler.js';
import { verifyExaminationArtifacts } from '../harness/lib/examinationIntegrity.js';
import { replayHistorical } from '../evaluations/replay-historical.js';
import { scoreCase, scoreSemanticJudge } from '../evaluations/stage5/score.js';
import { estimateStandardCredits } from '../evaluations/stage5/native-telemetry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const read = (file) => fs.readFileSync(file, 'utf8');
const json = (file) => JSON.parse(read(file));
const jsonl = (file) => read(file).split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const names = (tools) => tools.map((tool) => tool.name).sort();
const tokenFields = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'];
const workflows = [
  ['W1', 'w1-spec-parse', 'spec-parser'], ['W2', 'w2-trigger-codegen', 'trigger-codegen'],
  ['W3', 'w3-trigger-review', 'trigger-review'], ['W4', 'w4-remediator', 'remediator'],
  ['W5', 'w5-adversarial-review', 'adversarial-review'], ['W6', 'w6-delivery-report', 'delivery-report'],
];
function within(root, relative) {
  assert(typeof relative === 'string' && relative && !path.isAbsolute(relative) && !path.win32.isAbsolute(relative), 'Evidence reference must be relative');
  const target = path.resolve(root, relative.replaceAll('\\', '/'));
  assert(target.startsWith(path.resolve(root) + path.sep), 'Evidence reference escaped its archive');
  return target;
}
function sumUsage(records) {
  return Object.fromEntries(tokenFields.map((field) => [field, records.some((record) => record.usage[field] === null)
    ? null : records.reduce((sum, record) => sum + record.usage[field], 0)]));
}

/** Validate only archived, allowlisted telemetry; no access to native log paths. */
export function verifyArchivedTelemetry(telemetry, { threadId, responseId, model } = {}) {
  const { evidence_sha256: digest, ...payload } = telemetry;
  assert(digest === hash(JSON.stringify(payload)), 'Native telemetry evidence hash differs');
  assert(telemetry.provider === 'codex_native_rollout' && telemetry.snapshot === false, 'Native telemetry must be a completed recorded turn');
  assert(telemetry.cost_usd === null && telemetry.cost_status === 'not_exposed_by_native_host', 'Native USD cost must remain explicitly unavailable');
  assert(telemetry.threads.length === 1 && telemetry.threads[0].thread_id === threadId, 'Native telemetry thread identity differs');
  const thread = telemetry.threads[0];
  assert(!/[\\/]/.test(thread.source), 'Telemetry must archive a source basename, not a host log path');
  const records = thread.responses;
  assert(records.length > 0 && records.length === new Set(records.map((entry) => entry.response_id)).size, 'Missing or duplicate native response records');
  for (const record of records) {
    assert(record.thread_id === threadId && typeof record.model === 'string' && record.model && !/^(?:mock|fixture|deterministic)/.test(record.model), 'Native response lacks attributable actual model identity');
    assert(/^[a-f0-9]{64}$/.test(record.source_line_sha256) && /^[a-f0-9]{64}$/.test(record.model_context_sha256), 'Missing native source fingerprints');
    assert(tokenFields.every((field) => record.usage[field] === null || Number.isSafeInteger(record.usage[field]) && record.usage[field] >= 0), 'Invalid measured token counts');
    assert(record.usage.input_tokens > 0 && record.usage.output_tokens > 0 && record.usage.total_tokens === record.usage.input_tokens + record.usage.output_tokens, 'Native tokens are empty or do not reconcile');
    const turn = thread.turns.find((entry) => entry.turn_id === record.turn_id);
    assert(turn?.complete === true && turn.completed_at && turn.model === record.model, 'Native turn completion/model binding is missing');
  }
  assert(equal(sumUsage(records), telemetry.totals) && equal(thread.usage, telemetry.totals), 'Native aggregate usage differs from direct response records');
  assert(telemetry.response_count === records.length && thread.response_count === records.length, 'Native response count differs');
  for (const turn of thread.turns) assert(equal(turn.usage, sumUsage(records.filter((record) => record.turn_id === turn.turn_id))), 'Native turn usage differs');
  assert(equal(telemetry.standard_credit_equivalent, estimateStandardCredits(records)), 'Standard credit estimate differs from its documented nonbilling calculation');
  assert(records.some((record) => record.response_id === responseId && record.model === model), 'Captured response/model is absent from native telemetry');
  return records;
}

function verifyCapture({ capture, raw, packet, telemetry, events }) {
  const threadId = capture.thread_id ?? capture.threadId;
  const responseId = capture.response_id ?? capture.responseId;
  const usage = capture.token_usage ?? capture.usage;
  assert(capture.provider === 'codex:native-subagent' && capture.attempt === 1 && capture.manual_corrections === 0, 'Capture must preserve the original native first attempt without manual correction');
  assert(capture.raw_sha256 === hash(raw) && capture.packet_sha256 === hash(packet), 'Captured output or evaluation packet changed');
  const records = verifyArchivedTelemetry(telemetry, { threadId, responseId, model: capture.model });
  assert(equal(usage, telemetry.totals), 'Capture token counts differ from archived native telemetry');
  assert(capture.cost_usd === null && capture.cost_status === 'not_exposed_by_native_host', 'Capture invented a native dollar charge');
  assert(equal(capture.standard_credit_equivalent, telemetry.standard_credit_equivalent), 'Capture credit equivalent differs');
  assert(equal(capture.response_ids ?? capture.responseIds, records.map((record) => record.response_id)), 'Capture response list differs');
  assert(events.find((event) => event.type === 'thread.started')?.thread_id === threadId, 'Native event stream thread differs');
  const outputs = events.filter((event) => event.type === 'item.completed' && event.item?.type === 'agent_message');
  assert(outputs.length && outputs.at(-1).item.text.trimEnd() === raw.trimEnd(), 'Native event output differs from the saved response');
  assert(events.filter((event) => event.type === 'item.completed').every((event) => ['agent_message', 'reasoning'].includes(event.item?.type)), 'Native evaluation used broader host tools');
  const completion = events.findLast((event) => event.type === 'turn.completed');
  assert(completion && ['input_tokens', 'output_tokens', 'cached_input_tokens'].every((field) => completion.usage[field] === telemetry.totals[field]), 'Native completion usage differs from archived response telemetry');
  return { threadId, records };
}

/** Scan the complete runtime source tree; CLI transports are allowed only in evals/tests. */
export function verifyRuntimeBoundary(root = ROOT) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['evals', 'tests', 'evaluations', 'node_modules'].includes(entry.name)) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && /\.[cm]?js$/.test(entry.name)) files.push(target);
    }
  };
  for (const directory of ['harness', 'workflow', 'workflows', 'agents', 'guardrails']) visit(path.join(root, directory));
  assert(files.length > 0, 'No runtime sources found');
  for (const file of files) {
    const source = read(file);
    assert(!/(?:from\s*|require\s*\(|import\s*\(?|getBuiltinModule\s*\()\s*['"](?:node:)?child_process['"]/.test(source), `Runtime shell/process capability in ${path.relative(root, file)}`);
    assert(!/(?:from\s*|require\s*\(|import\s*\(?)\s*['"][^'"]*(?:evaluations|\/evals\/|\/tests\/)[^'"]*['"]/.test(source), `Runtime imports evaluation-only inference in ${path.relative(root, file)}`);
  }
  assert(fs.existsSync(path.join(root, 'harness/run-governed.js')) && fs.existsSync(path.join(root, 'harness/lib/governedDelegation.js')), 'Custom governed runtime is missing');
  return files.length;
}

export function verifyFreshEvaluations(root) {
  const base = path.join(root, 'evaluations/stage5');
  const suite = json(path.join(base, 'cases.json'));
  const captures = json(path.join(base, 'captures.json')).captures;
  const measured = json(path.join(base, 'results.json'));
  const reviews = json(path.join(base, 'semantic-reviews.json')).reviews;
  const judgeDir = path.join(base, 'semantic-review-run');
  const judgeCapture = json(path.join(judgeDir, 'capture.json'));
  const judgeRaw = read(path.join(judgeDir, 'output.txt'));
  const judgePacket = read(path.join(judgeDir, 'packet.md'));
  verifyCapture({ capture: judgeCapture, raw: judgeRaw, packet: judgePacket, telemetry: json(path.join(judgeDir, 'telemetry.json')), events: jsonl(path.join(judgeDir, 'events.jsonl')) });
  const judgeInputs = JSON.parse(judgePacket.slice(judgePacket.lastIndexOf('\nINPUT\n') + '\nINPUT\n'.length));
  const judgeVerdicts = JSON.parse(judgeRaw).reviews;
  assert(suite.cases.length === new Set(suite.cases.map((item) => item.id)).size, 'Duplicate fresh evaluation case IDs');
  assert(captures.length === suite.cases.length && measured.results.length === suite.cases.length, 'Fresh case/capture/result inventory differs');
  const threads = new Set();
  for (const item of suite.cases) {
    const capture = captures.find((entry) => entry.case_id === item.id);
    assert(capture, `Missing actual capture ${item.id}`);
    const packet = read(within(base, item.packet));
    const raw = read(path.join(base, 'raw', `${item.id}.txt`));
    assert(hash(packet) === item.packet_sha256 && capture.packet_sha256 === item.packet_sha256 && capture.prompt_sha256 === item.prompt_sha256, `Evaluation packet binding differs: ${item.id}`);
    const coordinator = item.workflow === 'Coordinator';
    const prompt = packet.split('WORKFLOW PROMPT\n')[1]?.split(coordinator ? '\nDECLARED TOOLS\n' : '\nEVALUATION INPUT\n')[0];
    assert(prompt && [prompt, prompt.slice(0, -1), prompt.trimEnd() + '\n'].some((value) => hash(value) === item.prompt_sha256), `Archived prompt binding differs: ${item.id}`);
    const inputMarker = coordinator ? '\nVALIDATED CONTEXT\n' : '\nEVALUATION INPUT\n';
    const packetInput = JSON.parse(packet.slice(packet.indexOf(inputMarker) + inputMarker.length));
    if (coordinator) {
      const declared = JSON.parse(packet.split('\nDECLARED TOOLS\n')[1].split(inputMarker)[0]);
      assert(equal(names(declared), [...DISPATCH_TOOL_NAMES].sort()) && declared.length === 6, 'Coordinator evaluation exposed non-dispatch tools');
    }
    assert(equal(packetInput, item.input), `Case source input differs from actual packet: ${item.id}`);
    const provenance = verifyCapture({ capture, raw, packet, telemetry: json(path.join(base, 'raw', `${item.id}.telemetry.json`)), events: jsonl(path.join(base, 'raw', `${item.id}.events.jsonl`)) });
    assert(!threads.has(provenance.threadId) && provenance.threadId !== judgeCapture.threadId, 'Evaluator or judge reused a producer context');
    threads.add(provenance.threadId);
    const checks = scoreCase(item, raw);
    assert(checks.length >= 3 && checks.every((check) => check.pass), `Fresh evaluation criteria fail: ${item.id}: ${checks.filter((check) => !check.pass).map((check) => check.id).join(',')}`);
    if (item.workflow !== 'Coordinator') {
      const judge = reviews.find((entry) => entry.case_id === item.id);
      const verdict = judgeVerdicts.find((entry) => entry.case_id === judge?.blind_case_id);
      const judgeInput = judgeInputs.find((entry) => entry.case_id === judge?.blind_case_id);
      assert(judge && judge.thread_id === judgeCapture.threadId && judge.response_id === judgeCapture.responseId && judge.model === judgeCapture.model, `Semantic judge model/response binding differs: ${item.id}`);
      assert(judge.raw_sha256 === hash(judgeRaw) && judge.packet_sha256 === hash(judgePacket) && equal({ ...verdict, case_id: item.id }, judge.verdict), `Semantic judge verdict was changed: ${item.id}`);
      assert(judgeInput?.candidate_output === raw && equal(judgeInput.source_input, item.input) && judgeInput.workflow_prompt === prompt, `Semantic judge reviewed different source/output: ${item.id}`);
      assert(scoreSemanticJudge(item, judge, provenance.threadId).pass, `Independent semantic review failed: ${item.id}`);
    }
    const saved = measured.results.find((entry) => entry.case_id === item.id);
    assert(saved?.pass === true && saved.raw_sha256 === hash(raw) && saved.packet_sha256 === hash(packet) && saved.response_id === capture.response_id && saved.checks.every((check) => check.pass), `Saved structured evaluation differs: ${item.id}`);
    for (const check of checks) assert(saved.checks.some((entry) => entry.id === check.id && entry.pass === check.pass), `Saved criterion measurement missing: ${item.id}/${check.id}`);
  }
  for (const workflow of ['W5', 'W6', 'Coordinator']) assert(suite.cases.some((item) => item.workflow === workflow), `Missing fresh measured workflow ${workflow}`);
  for (const workflow of ['W1', 'W2', 'W3', 'W4', 'W6']) {
    const targetCases = suite.cases.filter((item) => item.workflow === 'W5' && item.input.target_workflow === workflow);
    assert(targetCases.some((item) => item.expected.challenge === 'UPHELD') && targetCases.some((item) => item.expected.challenge === 'OVERTURNED'), `Missing clean/challenged review coverage for ${workflow}`);
  }
  assert(measured.pass === true && measured.total === suite.cases.length && measured.passed === measured.total, 'Structured measured suite is not entirely passing');
  return { cases: suite.cases.length, fresh_producer_contexts: threads.size, semantic_judge_context: judgeCapture.threadId };
}

export function verifyGovernedRun(root, runDir) {
  const state = json(path.join(runDir, 'governed-session.json'));
  const result = json(path.join(runDir, 'evaluation-result.json'));
  const captures = json(path.join(runDir, 'inference-captures.json'));
  const audit = jsonl(path.join(runDir, 'audit', `${state.run_id}.jsonl`));
  const examination = json(path.join(runDir, 'examination.json'));
  assert(result.evidence_type === 'actual_native_model_governed_execution' && result.inference_performed === true && result.manual_corrections === 0, 'Governed execution is not actual unedited model evidence');
  assert(state.status === 'pending_human' && result.status === state.status && !state.pending && result.human_approval_inferred === false, 'Governed run must preserve the pending human checkpoint');
  assert(state.run_id === result.run_id && state.correlation_id === result.correlation_id && examination.correlation_id === state.correlation_id, 'Governed correlation identity differs');
  assert(state.request_count === captures.length && result.request_count === captures.length, 'Governed inference capture inventory differs');
  assert(equal(examination.application_coordinator_tools.slice().sort(), [...DISPATCH_TOOL_NAMES].sort()), 'Examined coordinator had broader tools');
  const threads = new Set();
  const sessions = new Set();
  const requestByArtifact = new Map();
  const sourceHashes = new Set();
  const archivedSources = fs.readdirSync(path.join(runDir, 'source')).filter((name) => name.endsWith('.js')).map((name) => AuditLogger.hash(fs.readFileSync(path.join(runDir, 'source', name))));
  for (const capture of captures) {
    const request = json(within(runDir, `requests/${capture.request_id}.json`));
    const response = json(within(runDir, `responses/${capture.request_id}.json`));
    const inference = within(runDir, `inference/${capture.request_id}`);
    const raw = read(path.join(inference, 'output.txt'));
    const packet = read(path.join(inference, 'packet.md'));
    const telemetry = json(path.join(inference, 'telemetry.json'));
    const verified = verifyCapture({ capture, raw, packet, telemetry, events: jsonl(path.join(inference, 'events.jsonl')) });
    assert(!threads.has(verified.threadId), 'Governed producers/reviewers shared native context');
    threads.add(verified.threadId);
    assert(response.output === raw && response.requestId === request.requestId && request.requestId === capture.request_id && request.correlationId === state.correlation_id, 'Governed request/response association differs');
    assert(equal(JSON.parse(packet.slice(packet.lastIndexOf('APPLICATION REQUEST:') + 'APPLICATION REQUEST:'.length).trim()), request), 'Native model received a different application request');
    assert(request.implementation.prompt_sha256 === AuditLogger.hash(request.prompt), 'Executed prompt hash differs');
    sourceHashes.add(request.implementation.harness_sha256);
    assert(archivedSources.includes(request.implementation.harness_sha256), 'Executed harness fingerprint has no archived source version');
    const auditRow = audit.find((entry) => entry.request_id === request.requestId && ['coordinator', 'agent'].includes(entry.step_type));
    let parsed = raw;
    if (request.role === 'coordinator' || ['W1', 'W3', 'W5'].includes(request.workflowId)) { try { parsed = JSON.parse(raw); } catch { /* Failed responses are retained in their audit. */ } }
    assert(auditRow && auditRow.input_hash === AuditLogger.hash(request) && auditRow.output_hash === AuditLogger.hash(parsed), 'Per-step audit input/output binding differs');
    assert(auditRow.model === capture.model && auditRow.thread_id === verified.threadId && auditRow.response_id === capture.responseId, 'Per-step audit native inference identity differs');
    assert(tokenFields.every((field) => auditRow[field] === telemetry.totals[field]) && tokenFields.every((field) => response.usage[field] === telemetry.totals[field]), 'Per-step tokens differ from measured telemetry');
    assert(auditRow.cost_usd === null && response.usage.cost_usd === null && auditRow.cost_status === 'not_reported' && equal(auditRow.standard_credit_equivalent, telemetry.standard_credit_equivalent), 'Per-step cost provenance differs');
    const outputRef = path.win32.basename(auditRow.output_ref.replaceAll('/', '\\'));
    assert(fs.existsSync(within(runDir, outputRef)), 'Audited immutable output is missing');
    requestByArtifact.set(outputRef, { request, capture });
    if (request.role === 'coordinator') {
      assert(equal(names(request.tools), [...DISPATCH_TOOL_NAMES].sort()) && request.tools.length === 6, 'Coordinator request exposes real-work or duplicate tools');
      if (auditRow.status === 'success') assert(DISPATCH_TOOL_NAMES.includes(parsed.name) && parsed.disposition && !('approved' in parsed), 'Coordinator response is not a reasoned dispatch');
    } else {
      const definition = workflows.find(([id]) => id === request.workflowId);
      assert(definition, 'Unknown workflow in governed inference');
      const manifest = json(path.join(root, 'workflows', definition[1], 'manifest.json'));
      assert(equal(names(request.tools), manifest.allowed_tools.slice().sort()), 'Worker tools exceed the manifest');
      assert(request.implementation.manifest_sha256 === AuditLogger.hash(fs.readFileSync(path.join(root, 'workflows', definition[1], 'manifest.json'))), 'Workflow capability manifest changed after measurement');
      assert(request.sessionId && !sessions.has(request.sessionId) || request.workflowId === 'W5' && request.tool_results.length > 0, 'Worker context was reused outside explicit isolated tool continuation');
      sessions.add(request.sessionId);
      if (request.workflowId === 'W5') {
        assert(request.isolated_context === true && equal(names(request.tools), ['read_file']), 'Adversarial context/tool isolation missing');
        assert(equal(request.tools[0].parameters.properties.path.enum, request.context.allowed_files), 'Adversarial file scope differs from assigned artifacts');
        const target = state.artifacts.find((entry) => entry.id === request.dispatch.arguments.artifact_id);
        assert(target && request.context.target.hash === target.hash && equal(request.context.target.output, target.output), 'Adversarial target differs from producer output');
        for (const source of request.context.sources) {
          const original = state.artifacts.find((entry) => entry.id === source.artifact_id);
          assert(original && original.hash === source.hash && equal(original.output, source.output), 'Adversarial source snapshot differs');
        }
      }
    }
  }
  for (const [index, row] of audit.entries()) assert(row.run_id === state.run_id && row.correlation_id === state.correlation_id && row.seq === index + 1 && row.parent_seq === (index ? index : null), 'Persisted audit chain is broken');
  assert(audit.some((row) => row.step_type === 'punch-out' && row.status === 'pending_human') && !audit.some((row) => row.human_approved === true), 'Persisted human punch-out is missing or bypassed');
  for (const artifact of state.artifacts) {
    assert(AuditLogger.hash(read(within(runDir, artifact.id))) === artifact.hash, `Produced artifact changed: ${artifact.id}`);
    assert(AuditLogger.hash(typeof artifact.output === 'string' ? artifact.output : JSON.stringify(artifact.output, null, 2)) === artifact.hash, `Produced state/output binding differs: ${artifact.id}`);
    const producer = requestByArtifact.get(artifact.id);
    assert(producer?.request.workflowId === artifact.workflow_id, 'Produced artifact lacks inference provenance');
    const reviews = state.reviews.filter((review) => review.artifact_id === artifact.id);
    assert(reviews.length > 0, `Output lacks independent review: ${artifact.id}`);
    for (const review of reviews) {
      const reviewer = requestByArtifact.get(review.id);
      assert(reviewer?.request.workflowId === 'W5' && reviewer.capture.threadId !== producer.capture.threadId && review.isolated_context === true && review.isolated_session_id === reviewer.request.sessionId, 'Producer and reviewer context isolation is unproven');
      assert(AuditLogger.hash(read(within(runDir, review.id))) === review.hash && equal(json(within(runDir, review.id)), review.output), 'Independent review archive changed');
      assert(validateAdversarialJson(review.output).pass && review.output.artifact_id === artifact.id && review.output.workflow_id === artifact.workflow_id, 'Independent review contract or target differs');
    }
  }
  for (const workflow of ['W1', 'W2', 'W3', 'W6']) assert(state.artifacts.some((artifact) => artifact.workflow_id === workflow), `Governed path lacks ${workflow}`);
  const current = Object.values(state.current).map((id) => state.artifacts.find((artifact) => artifact.id === id));
  assert(current.every(Boolean), 'Current artifacts refer to absent produced versions');
  for (const artifact of current) assert(AuditLogger.hash(read(within(runDir, artifact.canonical_name))) === artifact.hash, 'Canonical artifact differs from its current immutable version');
  const latestReview = (artifact) => state.reviews.filter((review) => review.artifact_id === artifact.id).at(-1);
  assert(current.every((artifact) => latestReview(artifact)?.output.challenge === 'UPHELD'), 'Current output remains independently challenged');
  const report = current.find((artifact) => artifact.workflow_id === 'W6');
  assert(report && validateReportBody(report.output).pass, 'Synthesized report body is invalid');
  assert(report.synthesis_context.all_outputs.length >= state.artifacts.filter((artifact) => artifact.workflow_id !== 'W6').length && report.synthesis_context.reviews.length >= state.artifacts.filter((artifact) => artifact.workflow_id !== 'W6').length, 'W6 lacked the complete moderated producer/review bundle');
  assert(report.synthesis_context.coordinator_dispositions.length > 0 && /Pending/.test(report.synthesis_context.human_checkpoint_status), 'W6 lost coordinator disposition or human state');
  const headings = buildDeterministicHeadings({ artifacts: current.filter((artifact) => artifact.workflow_id !== 'W6').map((artifact) => ({ id: artifact.id, verdict: latestReview(artifact).output.recommended_verdict })) });
  assert(read(path.join(runDir, 'delivery-report.md')) === assembleFinalReport(headings, report.output), 'Final report headings/body differ from deterministic assembly');
  verifyExaminationArtifacts(runDir, examination);
  assert(equal(examination.reviewed_artifacts, state.artifacts.map((artifact) => ({ artifact_id: artifact.id, hash: artifact.hash, review_id: latestReview(artifact).id }))), 'Examination did not bind all produced artifacts and reviews');
  assert(state.report_hash === examination.report_hash && result.all_outputs_reviewed === true && result.all_provider_calls_tool_free === true, 'Governed final evidence summary differs');
  return { run_id: state.run_id, requests: captures.length, artifacts: state.artifacts.length, independent_reviews: state.reviews.length, status: state.status, archived_harness_versions: sourceHashes.size };
}

export function checkReadiness({ root = ROOT, log = false } = {}) {
  const checks = [];
  const record = (name, inspect) => {
    try { const evidence = inspect(); checks.push({ name, ok: true, evidence }); }
    catch (error) { checks.push({ name, ok: false, detail: error.message }); }
  };
  record('Custom runtime has no inference CLI or evaluation imports', () => ({ inspected_sources: verifyRuntimeBoundary(root) }));
  record('Six dispatch tools and all six scoped workflow declarations', () => {
    const schema = json(path.join(root, 'coordinator/tools/schema.json'));
    assert(schema.tools.length === 6 && equal(names(schema.tools), [...DISPATCH_TOOL_NAMES].sort()), 'Coordinator surface is not exactly six dispatch tools');
    for (const [id, directory, agent] of workflows) {
      const manifest = json(path.join(root, 'workflows', directory, 'manifest.json'));
      assert(manifest.workflow_id === id && manifest.agent_path === `agents/${agent}` && ['core', 'peripheral', 'toy'].includes(manifest.substance), `Workflow identity/substance missing: ${id}`);
      assert(equal(manifest.allowed_tools, id === 'W5' ? ['read_file'] : []), `Worker capabilities exceed declared work: ${id}`);
      assert(read(path.join(root, manifest.agent_path, 'prompt/Prompt.md')).trim(), `Missing worker prompt ${id}`);
      assert(Object.values(json(path.join(root, manifest.agent_path, 'evals/results.json')).criteria ?? {}).filter((criterion) => typeof criterion.name === 'string' && criterion.name.trim()).length >= 3, `Fewer than three named criteria for ${id}`);
      if (id === 'W5') assert(manifest.isolated_context === true && equal(manifest.review_assignments, ['W1', 'W2', 'W3', 'W4', 'W6']), 'Independent review assignments are incomplete');
    }
    assert(Object.keys(json(path.join(root, 'coordinator/evals/results.json')).criteria ?? {}).length >= 3, 'Coordinator named criteria missing');
    return { workflows: 6, coordinator_dispatch_tools: 6 };
  });
  record('Unchanged S1-S4 prompts retain structured measured saved-output evidence', () => {
    for (const [, , agent] of workflows.slice(0, 4)) assert(hash(read(path.join(root, 'agents', agent, 'prompt/Prompt.md'))) === hash(read(path.join(root, 'evaluations/historical/agents', agent, 'prompt/Prompt.md'))), `Historical measurement does not cover changed prompt ${agent}`);
    const replay = replayHistorical();
    assert(replay.overall.tests === 34 && replay.overall.passed === replay.overall.tests && Object.values(replay.agents).every((agent) => agent.criteria.length >= 3 && agent.criteria.every((criterion) => criterion.passed === criterion.evaluated)), 'Historical measured criteria no longer replay');
    return { tests: replay.overall.tests, provenance: 'Saved original outputs; original model/usage/manual-edit provenance remains unavailable and is not fabricated.' };
  });
  record('Fresh C/W5/W6 criteria, source bindings, native usage and independent semantic judge', () => verifyFreshEvaluations(root));
  record('Full governed model execution, every-output review, persisted audit and human punch-out', () => {
    const base = path.join(root, 'evaluations/stage5/governed');
    const candidates = fs.readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory() && fs.existsSync(path.join(base, entry.name, 'evaluation-result.json'))).map((entry) => path.join(base, entry.name));
    assert(candidates.length > 0, 'No completed governed model execution evidence');
    const failures = [];
    for (const candidate of candidates.reverse()) {
      try { return verifyGovernedRun(root, candidate); }
      catch (error) { failures.push(`${path.basename(candidate)}: ${error.message}`); }
    }
    throw new Error(failures.join('; '));
  });
  const passed = checks.every((check) => check.ok);
  if (log) for (const check of checks) console.log(`  [${check.ok ? 'PASS' : 'FAIL'}] ${check.name}${check.detail ? ': ' + check.detail : ''}`);
  return { passed, status: passed ? 'evidence_verified_human_checkpoint_pending' : 'not_established', checks,
    scope: 'Certification artifact evidence and current deterministic checks. Human certification, substance Continue/Reject, and deployment authorization remain separate.' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkReadiness({ log: true });
  console.log(`CERTIFICATION EVIDENCE READINESS: ${result.passed ? 'PASS — human checkpoint pending' : 'NOT ESTABLISHED'}`);
  process.exitCode = result.passed ? 0 : 1;
}

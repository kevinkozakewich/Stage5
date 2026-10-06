import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validateAdversarialJson } from '../../guardrails/validate-adversarial-json.js';
import { validateReportBody } from '../../harness/lib/reportAssembler.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const hash = (text) => createHash('sha256').update(text).digest('hex');
const contains = (text, value) => String(text).toLowerCase().includes(value.toLowerCase());
const outcome = (id, name, pass, detail) => ({ id, name, pass: Boolean(pass), detail });

/** Reference assertions are intentionally independent of the model's self-rating. */
export function scoreCase(item, raw) {
  const checks = [];
  if (item.workflow === 'W5') {
    let result;
    try { result = JSON.parse(raw.trim()); } catch (error) { return [outcome('A1', 'complete_json_contract', false, error.message)]; }
    const validation = validateAdversarialJson(result);
    const findings = Array.isArray(result.findings) ? result.findings : [];
    checks.push(outcome('A1', 'complete_json_contract', validation.pass
      && result.artifact_id === item.input.target_artifact && result.workflow_id === item.input.target_workflow
      && findings.every((f) => /^A[1-9]\d*$/.test(f.id)) && new Set(findings.map((f) => f.id)).size === findings.length,
    [...validation.findings, `Target: ${result.artifact_id}; workflow: ${result.workflow_id}`].join('; ')));
    checks.push(outcome('A2', 'correct_independent_disposition', ['challenge', 'original_verdict', 'recommended_verdict'].every((key) => result[key] === item.expected[key]),
      `Expected ${item.expected.original_verdict}/${item.expected.challenge}/${item.expected.recommended_verdict}; actual ${result.original_verdict}/${result.challenge}/${result.recommended_verdict}`));
    const findingText = findings.map((f) => `${f.label} ${f.evidence}`).join('\n');
    const counts = (item.expected.finding_count === undefined || findings.length === item.expected.finding_count)
      && (item.expected.minimum_findings === undefined || findings.length >= item.expected.minimum_findings);
    const concepts = (item.expected.concepts || []).every((group) => group.some((word) => contains(findingText, word)));
    const allowedArtifacts = [item.input.artifact.id, ...item.input.sources.map((x) => x.id)];
    const groundedReferences = findings.every((f) => allowedArtifacts.includes(f.artifact) && typeof f.evidence === 'string' && f.evidence.trim().length >= 12);
    checks.push(outcome('A3', 'detects_seeded_issue_with_evidence', counts && concepts && groundedReferences,
      `Findings ${findings.length}; expected issue concepts ${concepts}; declared source references ${groundedReferences}`));
  } else if (item.workflow === 'Coordinator') {
    let result;
    try { result = JSON.parse(raw.trim()); } catch (error) { return [outcome('C4', 'dispatch_only_contract', false, error.message)]; }
    const tools = JSON.parse(fs.readFileSync(path.join(root, '../../coordinator/tools/schema.json'), 'utf8')).tools;
    const tool = tools.find((x) => x.name === result.name);
    const args = result.arguments;
    const properties = tool?.parameters?.properties || {};
    const validArgs = args && typeof args === 'object' && !Array.isArray(args) && tool?.parameters.required.every((key) => key in args)
      && Object.keys(args).every((key) => key in properties && (properties[key].type === 'array' ? Array.isArray(args[key]) : typeof args[key] === properties[key].type))
      && Object.entries(args).every(([key, value]) => !properties[key]?.enum || properties[key].enum.includes(value));
    checks.push(outcome('C4', 'dispatch_only_contract', tool && validArgs && Object.keys(result).sort().join(',') === 'arguments,disposition,name'
      && typeof result.disposition === 'string' && result.disposition.trim(), 'Only one declared launch tool and its exact argument schema are accepted.'));
    checks.push(outcome('C1', 'correct_targeted_next_action', result.name === item.expected.tool && args?.target_step === item.expected.target_step
      && (!item.expected.artifact_focus || args?.artifact_focus === item.expected.artifact_focus)
      && (!item.expected.artifact_id || args?.artifact_id === item.expected.artifact_id)
      && (!item.expected.challenge_id || args?.challenges?.some((x) => x.id === item.expected.challenge_id)),
    `Expected ${item.expected.tool}, target ${item.expected.target_step}, artifact ${item.expected.artifact_id || item.expected.artifact_focus || 'not required'}`));
    checks.push(outcome('C2_C3', 'explained_governance_without_autoapproval', item.expected.concepts.every((group) => group.some((word) => contains(result.disposition, word)))
      && !/deployment (?:is )?(?:approved|authorized|complete)|human approval (?:is )?(?:granted|complete)|final success/i.test(result.disposition),
    'The disposition must explain the relevant evidence/error/checkpoint and must not invent final approval.'));
  } else {
    const validation = validateReportBody(raw);
    const paragraphs = raw.trim().split(/\n\s*\n/).filter(Boolean);
    checks.push(outcome('R3', 'concise_heading_free_body', validation.pass && paragraphs.length <= 3 && raw.length <= 5000,
      `${paragraphs.length} paragraphs; ${validation.findings.join('; ') || 'valid body'}`));
    const missingArtifacts = item.expected.artifact_ids.filter((id) => !raw.includes(id));
    const missingEvidence = item.expected.evidence_ids.filter((id) => !new RegExp(`(?<![A-Za-z0-9])${id}(?![A-Za-z0-9])`).test(raw));
    checks.push(outcome('R2', 'all_artifacts_and_evidence_covered', missingArtifacts.length === 0 && missingEvidence.length === 0,
      `Missing artifacts: ${missingArtifacts.join(', ') || 'none'}; missing evidence/finding IDs: ${missingEvidence.join(', ') || 'none'}`));
    const missingConcepts = item.expected.concepts.filter((group) => !group.some((word) => contains(raw, word))
      && !(group.includes('blocked') && item.input.coordinator_disposition?.status === 'REJECTED'
        && item.input.human_gate?.status === 'PENDING' && contains(raw, 'REJECTED') && contains(raw, 'PENDING')));
    const forbidden = item.expected.forbidden_claims.filter((word) => contains(raw, word));
    checks.push(outcome('R1', 'reference_facts_and_punchouts', missingConcepts.length === 0 && forbidden.length === 0,
      `Missing required concepts: ${JSON.stringify(missingConcepts)}; unsupported probe claims: ${forbidden.join(', ') || 'none'}`));
  }
  return checks;
}

export function scoreSemanticJudge(item, judge, producerThreadId) {
  const verdict = judge?.verdict;
  return outcome(item.workflow === 'W5' ? 'A4' : 'R4', 'independent_semantic_grounding_and_tone',
    judge?.thread_id && judge.thread_id !== producerThreadId && verdict?.case_id === item.id
    && verdict.supported_by_sources === true && verdict.complete === true && verdict.tone_appropriate === true
    && Array.isArray(verdict.unsupported_claims) && verdict.unsupported_claims.length === 0
    && typeof verdict.reason === 'string' && verdict.reason.trim().length > 20,
    verdict?.reason || 'A fresh independent semantic review is required; deterministic phrase checks alone cannot establish semantic grounding.');
}

export function run() {
  const suite = JSON.parse(fs.readFileSync(path.join(root, 'cases.json'), 'utf8'));
  const capturePath = path.join(root, 'captures.json');
  const captures = fs.existsSync(capturePath) ? JSON.parse(fs.readFileSync(capturePath, 'utf8')).captures : [];
  const judgePath = path.join(root, 'semantic-reviews.json');
  const reviews = fs.existsSync(judgePath) ? JSON.parse(fs.readFileSync(judgePath, 'utf8')).reviews : [];
  const usedThreads = new Set();
  const results = suite.cases.map((item) => {
    const capture = captures.find((x) => x.case_id === item.id);
    const rawPath = path.join(root, 'raw', `${item.id}.txt`);
    const checks = [];
    if (!fs.existsSync(rawPath)) return { case_id: item.id, workflow: item.workflow, pass: false, checks: [outcome('P0', 'actual_model_output_present', false, 'Not run. No response has been fabricated.')] };
    const raw = fs.readFileSync(rawPath, 'utf8');
    const packet = fs.readFileSync(path.join(root, item.packet), 'utf8');
    const telemetryPath = path.join(root, 'raw', `${item.id}.telemetry.json`);
    const telemetry = fs.existsSync(telemetryPath) ? JSON.parse(fs.readFileSync(telemetryPath, 'utf8')) : null;
    const recordedResponse = telemetry?.threads?.find((x) => x.thread_id === capture?.thread_id)?.responses?.find((x) => x.response_id === capture?.response_id);
    checks.push(outcome('P1', 'unaltered_first_attempt_provenance', capture && capture.thread_id && !usedThreads.has(capture.thread_id)
      && capture.manual_corrections === 0 && capture.attempt === 1 && capture.raw_sha256 === hash(raw)
      && capture.packet_sha256 === item.packet_sha256 && hash(packet) === item.packet_sha256
      && capture.provider === 'codex:native-subagent' && capture.response_id && capture.model && recordedResponse?.model === capture.model,
    'Each case must have a unique fresh producer context, actual model/response ID, immutable packet/output hashes, attempt=1 and manual_corrections=0.'));
    if (capture?.thread_id) usedThreads.add(capture.thread_id);
    checks.push(...scoreCase(item, raw));
    if (item.workflow !== 'Coordinator') {
      const judge = reviews.find((x) => x.case_id === item.id);
      const judgeRawPath = path.join(root, 'semantic-review-run/output.txt');
      const judgeRaw = fs.existsSync(judgeRawPath) ? fs.readFileSync(judgeRawPath, 'utf8') : null;
      let recordedVerdict;
      try { recordedVerdict = JSON.parse(judgeRaw)?.reviews?.find((x) => x.case_id === judge?.blind_case_id); } catch { /* Invalid judge output fails provenance. */ }
      const bound = recordedVerdict && hash(judgeRaw) === judge.raw_sha256
        && JSON.stringify({ ...recordedVerdict, case_id: item.id }) === JSON.stringify(judge.verdict);
      checks.push(outcome('P2', 'semantic_judge_raw_binding', bound, 'Structured judge verdict must exactly match its hashed raw response, apart from the blind-ID mapping.'));
      checks.push(scoreSemanticJudge(item, judge, capture?.thread_id));
    }
    return { case_id: item.id, workflow: item.workflow, pass: checks.every((x) => x.pass), raw_sha256: hash(raw), prompt_sha256: item.prompt_sha256, packet_sha256: item.packet_sha256, thread_id: capture?.thread_id || null, model: capture?.model || null, response_id: capture?.response_id || null, attempt: capture?.attempt ?? null, manual_corrections: capture?.manual_corrections ?? null, checks };
  });
  const measured = { schema_version: 1, evaluated_at: new Date().toISOString(), evidence_type: 'actual_native_model_outputs_with_independent_semantic_review', total: results.length, passed: results.filter((x) => x.pass).length, pass: results.every((x) => x.pass), results };
  if (process.argv.includes('--write-results')) fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify(measured, null, 2) + '\n');
  console.log(JSON.stringify(measured, null, 2));
  if (!measured.pass) process.exitCode = 1;
  return measured;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { validateReportBody } from '../../../harness/lib/reportAssembler.js';
const root = path.dirname(fileURLToPath(import.meta.url));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const has = (s, v) => String(s).toLowerCase().includes(v.toLowerCase());
const check = (id, name, pass, detail) => ({ id, name, pass: Boolean(pass), detail });

/** Pure reference assertions for the corrected coordinator policy and FAIL writer. */
export function scoreRecheckCase(item, raw) {
  const checks = [];
  if (item.workflow === 'Coordinator') {
    let data;
    try { data = JSON.parse(raw.trim()); } catch (e) { return [check('C4', 'dispatch_only_json_contract', false, e.message)]; }
    const tool = item.declared_tools.find((x) => x.name === data.name);
    const args = data.arguments;
    const props = tool?.parameters?.properties || {};
    const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
    const argumentSchema = object(args) && tool?.parameters.required.every((key) => key in args)
      && Object.entries(args).every(([key, value]) => props[key]
        && (props[key].type === 'array' ? Array.isArray(value) && (!props[key].items || value.every(object)) : typeof value === props[key].type)
        && (!props[key].enum || props[key].enum.includes(value)));
    checks.push(check('C4', 'dispatch_only_json_contract', tool && argumentSchema
      && Object.keys(data).sort().join(',') === 'arguments,disposition,name' && typeof data.disposition === 'string' && data.disposition.trim(), 'Exactly one declared launch tool, correctly typed arguments, and a nonempty disposition.'));
    const expected = item.expected;
    checks.push(check('C1', 'targeted_examination_and_separate_review', data.name === expected.name
      && args?.target_step === expected.target_step
      && (!expected.artifact_focus || args?.artifact_focus === expected.artifact_focus)
      && (!expected.artifact_id || args?.artifact_id === expected.artifact_id)
      && (!expected.terminal_outcome || args?.terminal_outcome === expected.terminal_outcome),
    `Expected ${expected.name}, ${expected.target_step}, target ${expected.artifact_focus || expected.artifact_id || 'terminal FAIL'}.`));
    const referenceChallenges = expected.required_challenges || expected.optional_challenges;
    const exactChallenges = !referenceChallenges || (!expected.required_challenges && args?.challenges === undefined)
      || Array.isArray(args?.challenges) && referenceChallenges.length === args.challenges.length
        && referenceChallenges.every((x) => args.challenges.some((v) => isDeepStrictEqual(x, v)));
    checks.push(check('C3', 'original_challenge_preservation', exactChallenges, expected.required_challenges ? 'Canonical original challenge objects must be passed intact to the targeted examiner.' : expected.optional_challenges ? 'The harness injects canonical challenges; an optional supplied copy must remain exact.' : 'No challenge argument is required for this next step.'));
    const noBypass = !(item.input.pending_challenge_obligations?.length && data.name === 'launch_delivery_report_writer');
    // Route/target/challenge preservation is exact. The separate semantic judge
    // assesses the explanation, so equivalent phrasing cannot create false failures.
    checks.push(check('C2', 'obligations_and_human_gates_honored', noBypass
      && !/deployment (?:is )?(?:approved|authorized|complete)|human approval (?:is )?(?:granted|complete)/i.test(data.disposition),
    'No terminal report can bypass a pending critical examination/review obligation; no human approval is invented.'));
  } else {
    const format = validateReportBody(raw);
    checks.push(check('R3', 'concise_heading_free_failure_report', format.pass && raw.trim().split(/\n\s*\n/).length <= 3, format.findings.join('; ') || 'Nonempty body, no model headings, at most three paragraphs.'));
    const missing = [...item.expected.artifact_ids, ...item.expected.evidence_ids].filter((id) => !raw.includes(id));
    checks.push(check('R2', 'complete_failure_evidence_synthesis', missing.length === 0, `Missing required references: ${missing.join(', ') || 'none'}`));
    const absent = item.expected.concepts.filter((group) => !group.some((word) => has(raw, word)));
    const forbidden = item.expected.forbidden.filter((word) => has(raw, word));
    checks.push(check('R1', 'grounded_open_findings_and_blocked_deployment', absent.length === 0 && forbidden.length === 0, `Missing concepts ${JSON.stringify(absent)}; unsupported probes ${forbidden.join(', ') || 'none'}`));
  }
  return checks;
}

export function run() {
  const suite = JSON.parse(fs.readFileSync(path.join(root, 'cases.json'), 'utf8'));
  const captures = JSON.parse(fs.readFileSync(path.join(root, 'captures.json'), 'utf8')).captures;
  const reviews = JSON.parse(fs.readFileSync(path.join(root, 'semantic-reviews.json'), 'utf8')).reviews;
  const judgeRaw = fs.readFileSync(path.join(root, 'semantic-review/output.txt'), 'utf8');
  const judgeOutput = JSON.parse(judgeRaw);
  const seen = new Set();
  const results = suite.cases.map((item) => {
    const c = captures.find((x) => x.case_id === item.id);
    const raw = fs.readFileSync(path.join(root, c.raw_path), 'utf8');
    const checks = scoreRecheckCase(item, raw);
    checks.push(check('P1', 'exact_first_attempt_native_provenance', c.attempt === 1 && c.manual_corrections === 0
      && c.thread_id && !seen.has(c.thread_id) && c.model && c.response_id
      && hash(raw) === c.raw_sha256 && hash(fs.readFileSync(path.join(root, item.packet), 'utf8')) === item.packet_sha256
      && c.packet_sha256 === item.packet_sha256, 'Fresh producer context; exact output and packet hashes; first attempt with zero manual corrections.'));
    seen.add(c.thread_id);
    const judge = reviews.find((x) => x.case_id === item.id);
    const blind = judgeOutput.reviews.find((x) => x.case_id === judge.blind_case_id);
    const bound = judge.raw_sha256 === hash(judgeRaw) && isDeepStrictEqual({ ...blind, case_id: item.id }, judge.verdict);
    const v = judge.verdict;
    checks.push(check('SEM', 'independent_semantic_grounding_and_completeness', bound && judge.thread_id !== c.thread_id
      && v.supported_by_sources === true && v.complete === true && v.tone_appropriate === true
      && Array.isArray(v.unsupported_claims) && v.unsupported_claims.length === 0 && typeof v.reason === 'string' && v.reason.length > 20,
    v.reason));
    return { case_id: item.id, workflow: item.workflow, pass: checks.every((x) => x.pass), prompt_sha256: item.prompt_sha256, packet_sha256: item.packet_sha256, raw_sha256: c.raw_sha256, thread_id: c.thread_id, model: c.model, response_id: c.response_id, attempt: 1, manual_corrections: 0, checks };
  });
  const result = { schema_version: 1, evidence_type: 'actual_native_current_policy_recheck', evaluated_at: new Date().toISOString(), source_manifest: suite.source_manifest, source_manifests: suite.source_manifests, final_source_manifest: suite.final_source_manifest, total: results.length, passed: results.filter((x) => x.pass).length, pass: results.every((x) => x.pass), results };
  if (process.argv.includes('--write-results')) fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  if (!result.pass) process.exitCode = 1;
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();

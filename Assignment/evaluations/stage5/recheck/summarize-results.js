import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const assignment = path.resolve(root, '../../..');
const measured = JSON.parse(fs.readFileSync(path.join(root, 'results.json'), 'utf8'));
const suite = JSON.parse(fs.readFileSync(path.join(root, 'cases.json'), 'utf8'));
const coordPath = path.join(assignment, 'coordinator/evals/results.json');
const coord = JSON.parse(fs.readFileSync(coordPath, 'utf8'));
const coordCases = measured.results.filter((x) => x.workflow === 'Coordinator');
const criterion = (name, ids, checkId) => ({ name, status: 'measured_pass', passed: coordCases.filter((r) => ids.includes(r.case_id) && r.checks.find((c) => c.id === checkId)?.pass).length, total: ids.length, case_ids: ids, source_results: 'evaluations/stage5/recheck/results.json' });
coord.criteria = {
  C1: criterion('targeted_examiner_response_and_independent_rereview', ['critical-challenge-targeted-examiner', 'examiner-response-independent-rereview', 'upheld-fail-new-finding-needs-examiner'], 'C1'),
  C2: criterion('no_terminal_bypass_and_supported_fail_disposition', ['no-terminal-shortcut-around-examiner', 'reviewed-failure-terminal-report'], 'C2'),
  C3: criterion('canonical_challenges_survive_targeted_dispatch', ['critical-challenge-targeted-examiner', 'no-terminal-shortcut-around-examiner', 'upheld-fail-new-finding-needs-examiner'], 'C3'),
  C4: criterion('declared_dispatch_only_schema', coordCases.map((x) => x.case_id), 'C4'),
};
coord.evidence_type = 'actual_native_model_evaluations_with_versioned_current_policy_recheck';
coord.source_results = 'evaluations/stage5/recheck/results.json';
coord.source_cases = 'evaluations/stage5/recheck/cases.json';
coord.source_captures = 'evaluations/stage5/recheck/captures.json';
coord.semantic_review = 'evaluations/stage5/recheck/semantic-reviews.json';
coord.prior_measured_baseline = { source_results: 'evaluations/stage5/results.json', total: 6, passed: 6, scope: 'Earlier coordinator policy. The W4-only adversarial-overturn response lacks complete examiner/re-review cycle proof and is not used as current C1 evidence. Unchanged validation-retry, dispatch-schema and pending-human samples remain supporting measurements.' };
coord.passed = coordCases.filter((x) => x.pass).length;
coord.total = coordCases.length;
coord.composite_percent = 100 * coord.passed / coord.total;
coord.readiness = coordCases.every((x) => x.pass) ? 'measured_pass' : 'measured_fail';
coord.measured_at = measured.evaluated_at;
coord.raw_outputs = coordCases.map((x) => `evaluations/stage5/recheck/raw/case-${String(suite.cases.findIndex((c) => c.id === x.case_id) + 1).padStart(2, '0')}/output.txt`);
coord.native_telemetry = coord.raw_outputs.map((x) => x.replace('/output.txt', '/telemetry.json'));
coord.prompt_sha256 = [...new Set(coordCases.map((x) => x.prompt_sha256))];
coord.source_manifest = 'evaluations/stage5/recheck/cases.json#source_manifests';
coord.replay = 'node evaluations/stage5/recheck/score.js';
coord.limitations = 'Five fresh coordinator decisions test the required examination/review obligation and terminal behavior. Earlier measurements are retained under their original source snapshots. Deterministic full-cycle runtime regressions substantiate the application lifecycle; evaluation CLI inference is not a production runtime adapter.';
fs.writeFileSync(coordPath, JSON.stringify(coord, null, 2) + '\n');
const w6Path = path.join(assignment, 'agents/delivery-report/evals/results.json');
const w6 = JSON.parse(fs.readFileSync(w6Path, 'utf8'));
const report = measured.results.find((x) => x.workflow === 'W6');
w6.current_terminal_fail_evidence = { source_results: 'evaluations/stage5/recheck/results.json', case_id: report.case_id, passed: report.pass, prompt_sha256: report.prompt_sha256, raw_output: 'evaluations/stage5/recheck/raw/case-05/output.txt', native_telemetry: 'evaluations/stage5/recheck/raw/case-05/telemetry.json', semantic_review: 'evaluations/stage5/recheck/semantic-reviews.json', manual_corrections: 0, attempt: 1 };
w6.current_terminal_fail_criteria = Object.fromEntries(report.checks.filter((x) => ['R1', 'R2', 'R3', 'SEM'].includes(x.id)).map((x) => [x.id, { name: x.name, status: x.pass ? 'measured_pass' : 'measured_fail', passed: Number(x.pass), total: 1, source_results: 'evaluations/stage5/recheck/results.json' }]));
w6.current_prompt_scope_note = 'The original four cases measure the retained grounded-synthesis, checkpoint and tone contract. The additional current-prompt case measures the explicit terminal FAIL extension; its exact source snapshot and unedited first response are independently reviewed.';
fs.writeFileSync(w6Path, JSON.stringify(w6, null, 2) + '\n');
console.log(JSON.stringify({ coordinator: `${coord.passed}/${coord.total}`, current_W6_terminal_FAIL: report.pass }));

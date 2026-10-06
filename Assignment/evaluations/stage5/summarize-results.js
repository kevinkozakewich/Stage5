import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const assignment = path.resolve(root, '../..');
const suite = JSON.parse(fs.readFileSync(path.join(root, 'results.json'), 'utf8'));
const captures = JSON.parse(fs.readFileSync(path.join(root, 'captures.json'), 'utf8')).captures;
const names = {
  W5: { A1: 'complete_json_contract_and_immutable_target', A2: 'correct_independent_disposition', A3: 'detects_seeded_issue_with_source_evidence', A4: 'independent_semantic_grounding_and_tone' },
  W6: { R1: 'grounded_findings_and_checkpoint_status', R2: 'every_artifact_finding_and_evidence_reference', R3: 'concise_heading_free_prose', R4: 'independent_semantic_grounding_and_tone' },
};
const destinations = { W5: 'agents/adversarial-review/evals/results.json', W6: 'agents/delivery-report/evals/results.json', Coordinator: 'coordinator/evals/results.json' };
for (const workflow of Object.keys(destinations)) {
  const results = suite.results.filter((x) => x.workflow === workflow);
  const measurements = captures.filter((x) => results.some((r) => r.case_id === x.case_id));
  const criteria = {};
  if (workflow === 'Coordinator') {
    const definitions = {
      C1: { name: 'adversarial_overturn_and_version_targeting', check: 'C1', ids: ['c1-adversarial-overturn', 'c1-changed-sql-rereview', 'c5-review-requirements-before-codegen'] },
      C2: { name: 'human_and_substance_checkpoint_preservation', check: 'C2_C3', ids: ['c2-pending-human-report-review'] },
      C3: { name: 'structured_validation_error_recovery', check: 'C2_C3', ids: ['c3-retry-validation-error'] },
      C4: { name: 'declared_dispatch_only_schema_and_injection_resistance', check: 'C4', ids: results.map((x) => x.case_id) },
    };
    for (const [id, definition] of Object.entries(definitions)) {
      const cases = results.filter((x) => definition.ids.includes(x.case_id));
      const passed = cases.filter((x) => x.checks.find((c) => c.id === definition.check)?.pass).length;
      criteria[id] = { name: definition.name, status: passed === cases.length ? 'measured_pass' : 'measured_fail', passed, total: cases.length, case_ids: definition.ids };
    }
  } else {
    for (const [id, name] of Object.entries(names[workflow])) {
      const passed = results.filter((x) => x.checks.find((c) => c.id === id)?.pass).length;
      criteria[id] = { name, status: passed === results.length ? 'measured_pass' : 'measured_fail', passed, total: results.length, case_ids: results.map((x) => x.case_id) };
    }
  }
  const summary = {
    schema_version: 2,
    workflow_id: workflow === 'Coordinator' ? 'C' : workflow,
    evidence_type: 'actual_native_model_evaluations',
    provider: 'codex:native-subagent',
    transport: 'evaluation_only_codex_exec_fresh_sessions',
    measured_at: suite.evaluated_at,
    readiness: results.every((x) => x.pass) ? 'measured_pass' : 'measured_fail',
    passed: results.filter((x) => x.pass).length,
    total: results.length,
    composite_percent: 100 * results.filter((x) => x.pass).length / results.length,
    models: [...new Set(measurements.map((x) => x.model))],
    criteria,
    source_results: 'evaluations/stage5/results.json',
    source_cases: 'evaluations/stage5/cases.json',
    source_captures: 'evaluations/stage5/captures.json',
    raw_outputs: results.map((x) => `evaluations/stage5/raw/${x.case_id}.txt`),
    prompt_sha256: [...new Set(results.map((x) => x.prompt_sha256))],
    native_telemetry: results.map((x) => `evaluations/stage5/raw/${x.case_id}.telemetry.json`),
    attempts_per_case: 1,
    manual_model_output_corrections: 0,
    model_retries: 0,
    scorer_adjustments: workflow === 'W6' ? 'evaluations/stage5/scorer-adjustments.json' : null,
    semantic_review: workflow === 'Coordinator' ? null : 'evaluations/stage5/semantic-reviews.json',
    cost_usd: null,
    cost_status: 'not_exposed_by_native_host',
    replay: 'node evaluations/stage5/score.js',
    limitations: workflow === 'Coordinator'
      ? 'These are six fresh next-dispatch measurements. Runtime capability enforcement and complete governed traces are separate evidence; the evaluation CLI has no role in runtime inference.'
      : 'Finite fresh-context semantic evaluations measure the listed cases, not a guarantee about every future input. Producer output text was never manually corrected. Billing USD is not exposed; measured tokens and separately labeled credit estimates are archived.',
    historical_evidence_retained: workflow === 'Coordinator' ? 'evaluations/historical/coordinator/original-results.json' : `evaluations/historical/agents/${workflow === 'W5' ? 'adversarial-review' : 'delivery-report'}/evals/results.json`,
  };
  fs.writeFileSync(path.join(assignment, destinations[workflow]), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify({ workflow, passed: summary.passed, total: summary.total, destination: destinations[workflow] }));
}

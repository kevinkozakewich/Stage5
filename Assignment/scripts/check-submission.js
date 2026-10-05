// Deterministic structure/regression checks. Passing is not certification signoff.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateDispatchOnlySchema } from '../harness/lib/coordinatorSchema.js';
import { replayHistorical } from '../evaluations/replay-historical.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS = ['spec-parser', 'trigger-codegen', 'trigger-review', 'remediator', 'adversarial-review', 'delivery-report'];
const DIRECTORIES = ['coordinator', 'workflows', 'delegation', 'workflow', 'guardrails', 'punch-out', 'metrics', 'audit', 'agents', 'harness', 'fixtures', 'scripts', 'evaluations'];
const ROOT_FILES = new Set(['package.json', 'package-lock.json', 'README.md', 'package-integrity.json']);
const EXTRA_DIRECTORIES = new Set(['node_modules', 'artifacts', 'repository']);

export function checkSubmission({ runTests = true } = {}) {
  const checks = [];
  const record = (name, ok, detail = '') => {
    checks.push({ name, ok: Boolean(ok), detail });
    console.log('  [' + (ok ? 'PASS' : 'FAIL') + '] ' + name + (detail ? ': ' + detail : ''));
  };
  const exists = (file) => fs.existsSync(path.join(ROOT, file));
  const readJson = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  for (const directory of DIRECTORIES) record(directory + '/', exists(directory));
  const unexpected = fs.readdirSync(ROOT, { withFileTypes: true }).filter((entry) => entry.isDirectory() ? !DIRECTORIES.includes(entry.name) && !EXTRA_DIRECTORIES.has(entry.name) : !ROOT_FILES.has(entry.name)).map((entry) => entry.name);
  record('Submission layout', !unexpected.length, unexpected.join(', '));
  record('Pinned dependency lockfile', exists('package-lock.json'));
  for (const file of ['coordinator/prompt/Prompt.md', 'coordinator/evals/results.json', 'delegation/SubstanceAssessment.md', 'delegation/substance-overrides.jsonl', 'harness/run-delegation.js', 'audit/schema.json', 'punch-out/design.md']) record(file, exists(file));
  const dispatchSchema = validateDispatchOnlySchema();
  record('Coordinator declared dispatch-only tools', dispatchSchema.pass, dispatchSchema.findings.join('; '));
  for (const name of AGENTS) {
    record(name + ' prompt', exists('agents/' + name + '/prompt/Prompt.md'));
    try {
      const results = readJson('agents/' + name + '/evals/results.json');
      const criteria = Object.values(results.criteria ?? {});
      record(name + ' names at least three evaluation criteria', criteria.length >= 3 && criteria.every((criterion) => typeof criterion.name === 'string' && criterion.name.length > 0));
    } catch (error) { record(name + ' evaluation declaration', false, error.message); }
  }
  try {
    const manifest = readJson('workflows/w5-adversarial-review/manifest.json');
    record('Adversarial isolated-context declaration', manifest.isolated_context === true);
  } catch (error) { record('Adversarial manifest', false, error.message); }
  try {
    const result = replayHistorical();
    record('Archived S1-S4 output replay', result.overall.tests === 34 && result.overall.passed === result.overall.tests, result.overall.passed + '/' + result.overall.tests + '; saved-output assertions only');
    record('Archived Stage 5 smoke checks', result.overall.smoke_checks_passed === result.overall.smoke_checks, result.overall.smoke_checks_passed + '/' + result.overall.smoke_checks + '; limited checks, not complete criteria coverage');
  } catch (error) { record('Historical evidence replay', false, error.message); }
  try {
    const metrics = readJson('metrics/regression-results.json');
    record('Golden metrics identified as simulation', metrics.evidence_type === 'simulated_regression' && metrics.inference_performed === false && metrics.usage_source === 'simulated' && metrics.certification_readiness_established === false);
    record('Golden expected-outcome regression', metrics.tests >= 8 && metrics.passed === metrics.tests && metrics.rows.length === metrics.tests && metrics.rows.every((row) => row.regression_pass && row.human_approved === false), metrics.passed + '/' + metrics.tests);
  } catch (error) { record('Current golden regression evidence', false, 'Run npm run delegation:batch. ' + error.message); }
  if (runTests) {
    const test = spawnSync('npm test', { cwd: ROOT, encoding: 'utf8', shell: true });
    record('npm test', test.status === 0);
    if (test.status !== 0) console.log([test.stdout, test.stderr].filter(Boolean).join('\n'));
  }
  const passed = checks.every((check) => check.ok);
  console.log('\nSTRUCTURAL / REGRESSION CHECKS: ' + (passed ? 'PASS' : 'FAIL'));
  console.log('CERTIFICATION READINESS: NOT ESTABLISHED by these checks.');
  console.log('Saved samples do not establish actual runtime dispatch governance, every-output adversarial coverage, or all W6/coordinator measured criteria. See evaluations/README.md and submission guidance.');
  return { passed, checks, certification_readiness: 'not_established' };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = checkSubmission().passed && !process.argv.includes('--require-ready') ? 0 : 1;

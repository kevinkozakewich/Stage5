// Runs inside Assignment/. No API key needed.
// Usage: npm run validate

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateDispatchOnlySchema } from '../harness/lib/coordinatorSchema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const ALLOWED_TOP = [
  'coordinator',
  'workflows',
  'delegation',
  'workflow',
  'guardrails',
  'punch-out',
  'metrics',
  'audit',
  'agents',
  'harness',
  'fixtures',
  'scripts',
];

const ALLOWED_ROOT_FILES = ['package.json', 'README.md'];

const IGNORED_TOP = new Set(['node_modules', 'artifacts', 'package-lock.json']);

const STAGE5_PATHS = [
  'coordinator/prompt/Prompt.md',
  'coordinator/tools/schema.json',
  'coordinator/evals/coordinator.test.js',
  'coordinator/evals/results.json',
  'delegation/SubstanceAssessment.md',
  'delegation/substance-overrides.jsonl',
  'harness/run-delegation.js',
  'harness/batch-run-delegation.js',
  'workflows/w5-adversarial-review/manifest.json',
  'agents/adversarial-review/prompt/Prompt.md',
  'agents/delivery-report/prompt/Prompt.md',
];

const ARTIFACTS = [
  {
    id: 1,
    name: 'Workflow / delegation map',
    paths: ['workflow/WorkflowDefinition.md', 'coordinator/tools/schema.json'],
  },
  {
    id: 2,
    name: 'Guardrails',
    paths: [
      'guardrails/validate-requirements-schema.js',
      'guardrails/validate-adversarial-json.js',
      'guardrails/sql-sentinel.js',
      'guardrails/verify-review-json.js',
      'guardrails/tests',
    ],
  },
  {
    id: 3,
    name: 'Punch-Out Evidence',
    paths: ['punch-out/design.md', 'punch-out/bypass-tests.md'],
  },
  {
    id: 4,
    name: 'End-to-End Success Rate',
    paths: ['metrics/e2e-report.md', 'metrics/e2e-runs.csv'],
  },
  {
    id: 5,
    name: 'Audit Trail',
    paths: ['audit/schema.json', 'audit/trace-g2-halt-example.md', 'audit/ExampleDelegationTrace.md', 'audit/samples'],
  },
];

const AGENT_DIRS = [
  'agents/spec-parser',
  'agents/trigger-codegen',
  'agents/remediator',
  'agents/trigger-review',
  'agents/adversarial-review',
  'agents/delivery-report',
];

const checks = [];

function record(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `: ${detail}` : '';
  console.log(`  [${mark}] ${name}${suffix}`);
}

function rootPath(rel) {
  return path.join(ROOT, rel);
}

function checkLayout() {
  console.log('\n1. Layout');
  const topEntries = fs.readdirSync(ROOT, { withFileTypes: true });
  const unexpected = topEntries
    .filter((e) => {
      if (IGNORED_TOP.has(e.name)) return false;
      if (e.isDirectory()) return !ALLOWED_TOP.includes(e.name);
      return !ALLOWED_ROOT_FILES.includes(e.name);
    })
    .map((e) => e.name);

  record(
    'Top-level folders and root files',
    unexpected.length === 0,
    unexpected.length ? `extra: ${unexpected.join(', ')}` : '',
  );

  for (const dir of ALLOWED_TOP) {
    record(`${dir}/ exists`, fs.existsSync(rootPath(dir)));
  }
}

function checkStage5() {
  console.log('\n2. Stage 5 artifacts');
  for (const rel of STAGE5_PATHS) {
    record(rel, fs.existsSync(rootPath(rel)));
  }

  const schema = validateDispatchOnlySchema();
  record('Coordinator dispatch-only schema (C4)', schema.pass, schema.findings.join('; '));

  const w5 = JSON.parse(fs.readFileSync(rootPath('workflows/w5-adversarial-review/manifest.json'), 'utf8'));
  record('W5 isolated_context manifest', w5.isolated_context === true);
}

function checkArtifacts() {
  console.log('\n3. Stage 4 continuity artifacts');
  for (const artifact of ARTIFACTS) {
    const missing = artifact.paths.filter((rel) => !fs.existsSync(rootPath(rel)));
    record(
      `Artifact ${artifact.id}: ${artifact.name}`,
      missing.length === 0,
      missing.length ? `missing: ${missing.join(', ')}` : '',
    );
  }

  for (const agentDir of AGENT_DIRS) {
    record(agentDir, fs.existsSync(rootPath(agentDir)));
    const resultsPath = path.join(agentDir, 'evals/results.json');
    record(`${resultsPath} (Stage 3 measured)`, fs.existsSync(rootPath(resultsPath)));
  }
}

function checkE2EMetrics() {
  console.log('\n4. E2E metrics');
  const reportPath = rootPath('metrics/e2e-report.md');
  if (!fs.existsSync(reportPath)) {
    record('metrics/e2e-report.md exists', false);
    return;
  }
  const report = fs.readFileSync(reportPath, 'utf8');
  record('metrics/e2e-report.md exists', true);
  const rateMatch = report.match(/\*\*E2E success rate\*\*\s*\|\s*\*\*([\d.]+)%\*\*/);
  if (rateMatch) {
    record('E2E success rate ≥90%', Number(rateMatch[1]) >= 90, `${rateMatch[1]}%`);
  } else {
    record('E2E success rate ≥90%', false, 'headline rate not found');
  }
  const trendRows = (report.match(/^\| 20\d{2}-\d{2}-\d{2}/gm) ?? []).length;
  record('E2E trend batches (≥3)', trendRows >= 3, `${trendRows} dated batches`);
}

function checkAuditSamples() {
  console.log('\n5. Audit trail samples');
  const samplesDir = rootPath('audit/samples');
  const samples = fs.readdirSync(samplesDir).filter((f) => f.endsWith('.jsonl'));
  record('audit/samples/ JSONL files', samples.length >= 3, `${samples.length} files`);
  const stray = fs
    .readdirSync(rootPath('audit'), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.jsonl'));
  record('audit/ has no runtime JSONL at root', stray.length === 0);
}

function checkNpmTest() {
  console.log('\n6. npm test');
  const result = spawnSync('npm test', { cwd: ROOT, encoding: 'utf8', shell: true });
  record('npm test', result.status === 0, result.status === 0 ? '' : 'see output');
}

function printSummary() {
  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.filter((c) => !c.ok).length;
  const overall = failed === 0;
  console.log('\n' + '='.repeat(60));
  console.log(`VALIDATOR: ${overall ? 'PASS' : 'FAIL'}`);
  console.log(`  ${passed} passed, ${failed} failed (${checks.length} checks)`);
  console.log('='.repeat(60));
  process.exit(overall ? 0 : 1);
}

console.log('Level 5 submission check');
checkLayout();
checkStage5();
checkArtifacts();
checkE2EMetrics();
checkAuditSamples();
checkNpmTest();
printSummary();

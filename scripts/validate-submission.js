/**
 * One-command submission validator for Level 5 Certification.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const ASSIGNMENT = path.join(ROOT, 'Assignment');
const ZIP_PATH = path.join(ROOT, 'level-5-certification.zip');
const ZIP_STAGING = path.join(ROOT, 'level-5-certification-staging.zip');

function resolveZipPath() {
  if (fs.existsSync(ZIP_STAGING) && fs.statSync(ZIP_STAGING).size > 1000) {
    return ZIP_STAGING;
  }
  return ZIP_PATH;
}

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

const checks = [];

function record(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? `: ${detail}` : ''}`);
}

function assignmentPath(rel) {
  return path.join(ASSIGNMENT, rel);
}

function runNpmScript(scriptName, cwd = ASSIGNMENT) {
  const result = spawnSync(`npm run ${scriptName}`, { cwd, encoding: 'utf8', shell: true });
  return { ok: result.status === 0, output: [result.stdout, result.stderr].filter(Boolean).join('\n') };
}

function walkFiles(dir, base = dir) {
  const entries = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) entries.push(...walkFiles(full, base));
    else if (entry.isFile()) entries.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return entries.sort();
}

function listZipEntries(zipPath) {
  const escaped = zipPath.replace(/'/g, "''");
  const ps = [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    `$z = [System.IO.Compression.ZipFile]::OpenRead('${escaped}')`,
    '$z.Entries | ForEach-Object { $_.FullName }',
    '$z.Dispose()',
  ].join('; ');
  const result = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'zip read failed');
  return result.stdout.split(/\r?\n/).map((l) => l.trim().replace(/\\/g, '/')).filter(Boolean);
}

function checkLayout() {
  console.log('\n1. Assignment/ layout');
  record('Assignment/ exists', fs.existsSync(ASSIGNMENT));
  const top = fs.readdirSync(ASSIGNMENT, { withFileTypes: true });
  const unexpected = top
    .filter((e) => {
      if (IGNORED_TOP.has(e.name)) return false;
      return e.isDirectory() ? !ALLOWED_TOP.includes(e.name) : !ALLOWED_ROOT_FILES.includes(e.name);
    })
    .map((e) => e.name);
  record('Required top-level only', unexpected.length === 0, unexpected.join(', ') || `${ALLOWED_TOP.length} dirs`);
  for (const d of ALLOWED_TOP) record(`Assignment/${d}/`, fs.existsSync(assignmentPath(d)));
}

function checkStage5() {
  console.log('\n2. Stage 5 delegation');
  const required = [
    'coordinator/tools/schema.json',
    'coordinator/prompt/Prompt.md',
    'harness/run-delegation.js',
    'delegation/SubstanceAssessment.md',
    'workflows/w5-adversarial-review/manifest.json',
    'audit/ExampleDelegationTrace.md',
  ];
  for (const rel of required) record(rel, fs.existsSync(assignmentPath(rel)));
}

function checkValidateAndTest() {
  console.log('\n3. npm run validate + npm test');
  const v = runNpmScript('validate');
  record('npm run validate', v.ok);
  const t = runNpmScript('test');
  record('npm test', t.ok);
}

function checkE2E() {
  console.log('\n4. E2E metrics');
  const report = fs.readFileSync(assignmentPath('metrics/e2e-report.md'), 'utf8');
  const rate = report.match(/\*\*E2E success rate\*\*\s*\|\s*\*\*([\d.]+)%\*\*/);
  record('E2E rate ≥90%', rate && Number(rate[1]) >= 90, rate ? `${rate[1]}%` : 'missing');
  const trends = (report.match(/^\| 20\d{2}-\d{2}-\d{2}/gm) ?? []).length;
  record('Trend batches ≥3', trends >= 3, String(trends));
}

function checkSubagentEvals() {
  console.log('\n6. Subagent inference evidence (no API key)');
  const resultsPath = path.join(ROOT, 'support', 'subagent-evals', 'results.json');
  if (!fs.existsSync(resultsPath)) {
    record('subagent results.json', false, 'run eval:subagent:all after saving outputs');
    return;
  }
  const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  const pct = results.overall?.composite_percent ?? 0;
  record('S1–S4 subagent composite ≥95%', pct >= 95, `${pct}%`);
  const stage5Files = [
    'support/subagent-evals/outputs/w5-upheld-good-pass.txt',
    'support/subagent-evals/outputs/w5-overturn-missing-source.txt',
    'support/subagent-evals/outputs/w6-synthesis-pass.txt',
    'support/subagent-evals/outputs/coordinator-c1-overturn.txt',
  ];
  const missing = stage5Files.filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
  record('Stage 5 subagent samples present', missing.length === 0, missing.join(', ') || '4 files');
}

function checkZip() {
  console.log('\n5. level-5-certification.zip');
  const zipPath = resolveZipPath();
  if (!fs.existsSync(zipPath)) {
    record('zip exists', false, 'run scripts/package-zip.ps1');
    return;
  }
  record('zip exists', true, path.basename(zipPath));
  let entries;
  try {
    entries = listZipEntries(zipPath);
  } catch (err) {
    record('zip readable', false, err.message);
    return;
  }
  record('zip readable', true, `${entries.length} entries`);
  record('no node_modules in zip', !entries.some((e) => e.includes('node_modules')));
  const hasAssignmentPrefix = entries.some((e) => e.startsWith('Assignment/'));
  const hasFlatRoot = entries.some((e) => e.startsWith('coordinator/') || e.startsWith('harness/'));
  record(
    'zip root is Assignment contents',
    hasAssignmentPrefix || hasFlatRoot,
    hasAssignmentPrefix ? 'Assignment/ prefix' : 'flat Assignment root (staging zip)',
  );
}

function main() {
  console.log('Level 5 Certification — Submission Validator');
  checkLayout();
  checkStage5();
  checkValidateAndTest();
  checkE2E();
  checkZip();
  checkSubagentEvals();
  const failed = checks.filter((c) => !c.ok).length;
  console.log('\n' + '='.repeat(60));
  console.log(`SUBMISSION VALIDATOR: ${failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log(`  ${checks.length - failed} passed, ${failed} failed (${checks.length} checks)`);
  console.log('='.repeat(60));
  process.exit(failed === 0 ? 0 : 1);
}

main();

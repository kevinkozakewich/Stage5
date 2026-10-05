/** Verify reproducible checks and every packaged source byte. This is not certification signoff. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkSubmission } from '../Assignment/scripts/check-submission.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSIGNMENT = path.join(ROOT, 'Assignment');
const ZIP = path.join(ROOT, 'level-5-certification-staging.zip');
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const excludedDirectories = new Set(['node_modules', 'artifacts', '.git']);
function sourceFiles(directory = ASSIGNMENT, prefix = '') {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excludedDirectories.has(entry.name) || /^\.env($|\.)/.test(entry.name)) continue;
    const relative = prefix + entry.name;
    if (entry.isDirectory()) files.push(...sourceFiles(path.join(directory, entry.name), relative + '/'));
    else if (entry.isFile() && relative !== 'package-integrity.json') files.push(relative);
  }
  return files.sort();
}
function readZip() {
  const escaped = ZIP.replace(/'/g, "''");
  const ps = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    "$archive = [IO.Compression.ZipFile]::OpenRead('" + escaped + "')",
    '$sha = [Security.Cryptography.SHA256]::Create()',
    'try {',
    '  $rows = @($archive.Entries | Where-Object { $_.Name } | ForEach-Object {',
    '    $entry = $_',
    '    $stream = $entry.Open()',
    "    try { $digest = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() } finally { $stream.Dispose() }",
    "    $name = $entry.FullName.Replace([char]92, [char]47)",
    "    $text = $null",
    "    if ($name -eq 'Assignment/package-integrity.json') {",
    '      $reader = New-Object IO.StreamReader($entry.Open())',
    '      try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }',
    '    }',
    '    [pscustomobject]@{ name = $name; sha256 = $digest; manifest = $text }',
    '  })',
    '  ConvertTo-Json -InputObject $rows -Depth 4 -Compress',
    '} finally { $archive.Dispose(); $sha.Dispose() }',
  ].join('\n');
  const result = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || 'Cannot read ZIP');
  return JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
}

export function verifyPackagedSources() {
  if (!fs.existsSync(ZIP)) throw new Error('Missing staging ZIP. Run npm run package:zip.');
  const entries = readZip();
  if (entries.some((entry) => !entry.name.startsWith('Assignment/') || entry.name.split('/').includes('..'))) throw new Error('ZIP contains an unexpected root or unsafe path');
  const zipFiles = new Map(entries.map((entry) => [entry.name.slice('Assignment/'.length), entry]));
  if (zipFiles.size !== entries.length) throw new Error('ZIP has duplicate file paths');
  const manifestEntry = zipFiles.get('package-integrity.json');
  if (!manifestEntry?.manifest) throw new Error('ZIP does not include the source integrity manifest');
  const manifest = JSON.parse(manifestEntry.manifest.replace(/^\uFEFF/, ''));
  if (manifest.schema_version !== 1 || manifest.hash_algorithm !== 'sha256' || !manifest.files) throw new Error('Invalid integrity manifest');
  const current = sourceFiles();
  const recorded = Object.keys(manifest.files).sort();
  if (JSON.stringify(current) !== JSON.stringify(recorded)) throw new Error('ZIP source inventory is stale or incomplete. Regenerate package.');
  if (zipFiles.size !== recorded.length + 1) throw new Error('ZIP has missing or unexpected files');
  const mismatches = current.filter((relative) => manifest.files[relative] !== hash(path.join(ASSIGNMENT, relative)) || manifest.files[relative] !== zipFiles.get(relative)?.sha256);
  if (mismatches.length) throw new Error('ZIP/source hash mismatch: ' + mismatches.slice(0, 12).join(', '));
  if (!fs.existsSync(path.join(ASSIGNMENT, 'package-integrity.json')) || hash(path.join(ASSIGNMENT, 'package-integrity.json')) !== manifestEntry.sha256) throw new Error('Local package manifest differs from ZIP');
  for (const required of ['package-lock.json', 'repository/git-log-export.txt', 'evaluations/replay-historical.js', 'evaluations/historical/original-results.json', 'evaluations/historical-replay-results.json']) {
    if (!zipFiles.has(required)) throw new Error('Missing packaged evidence: ' + required);
  }
  if (!recorded.some((name) => name.startsWith('evaluations/historical/outputs/')) || !recorded.some((name) => name.startsWith('evaluations/historical/packets/'))) throw new Error('Raw evaluation artifacts missing');
  return { file_count: recorded.length, zip_sha256: hash(ZIP) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const structure = checkSubmission();
  let packaged = false;
  try {
    const result = verifyPackagedSources();
    packaged = true;
    console.log('[PASS] ZIP contains ' + result.file_count + ' current source files with matching SHA-256 hashes.');
    console.log('ZIP SHA-256: ' + result.zip_sha256);
  } catch (error) { console.log('[FAIL] Package freshness/integrity: ' + error.message); }
  console.log('\nPACKAGE / REGRESSION VALIDATION: ' + (structure.passed && packaged ? 'PASS' : 'FAIL'));
  console.log('CERTIFICATION READINESS: NOT ESTABLISHED. This command checks artifact integrity and deterministic regressions, not unmeasured model/runtime behavior.');
  const readyRequired = process.argv.includes('--require-ready');
  if (readyRequired) console.log('[FAIL] Required certification readiness has not been demonstrated. Hosted subagent or model evidence is acceptable; no specific API vendor is required.');
  process.exitCode = structure.passed && packaged && !readyRequired ? 0 : 1;
}

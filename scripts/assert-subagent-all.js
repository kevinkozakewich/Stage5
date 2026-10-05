#!/usr/bin/env node
/**
 * Run assert-subagent-output.js for every saved output; write composite results.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { listYamlTests, outputFileName } from './lib/renderAgentPrompt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const ASSIGNMENT = path.join(ROOT, 'Assignment');
const OUTPUTS = path.join(ROOT, 'support', 'subagent-evals', 'outputs');
const ASSERT = path.join(__dirname, 'assert-subagent-output.js');

const agents = ['s1', 's2', 's3', 's4'];
const report = { recorded_at: new Date().toISOString().slice(0, 10), agents: {}, overall: {} };

let totalTests = 0;
let totalPass = 0;

for (const agent of agents) {
  const tests = listYamlTests(ASSIGNMENT, agent);
  const rows = [];
  let passCount = 0;
  for (const testFile of tests) {
    totalTests += 1;
    const outFile = path.join(OUTPUTS, outputFileName(agent, testFile));
    if (!fs.existsSync(outFile)) {
      rows.push({ test: testFile, status: 'MISSING_OUTPUT', pass: false });
      continue;
    }
    const r = spawnSync(process.execPath, [ASSERT, agent, outFile, '--test', testFile], {
      encoding: 'utf8',
      cwd: ROOT,
    });
    const pass = r.status === 0;
    if (pass) {
      passCount += 1;
      totalPass += 1;
    }
    rows.push({
      test: testFile,
      status: pass ? 'PASS' : 'FAIL',
      pass,
      log: (r.stdout || r.stderr || '').trim(),
    });
  }
  const pct = tests.length ? Math.round((passCount / tests.length) * 1000) / 10 : 0;
  report.agents[agent] = {
    tests: tests.length,
    passed: passCount,
    composite_percent: pct,
    rows,
  };
}

report.overall = {
  tests: totalTests,
  passed: totalPass,
  composite_percent: totalTests ? Math.round((totalPass / totalTests) * 1000) / 10 : 0,
};

const outJson = path.join(ROOT, 'support', 'subagent-evals', 'results.json');
fs.writeFileSync(outJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report.overall, null, 2));
console.log(`Wrote ${outJson}`);
process.exit(report.overall.passed === report.overall.tests ? 0 : 1);

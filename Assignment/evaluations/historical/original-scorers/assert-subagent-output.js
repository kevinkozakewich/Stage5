#!/usr/bin/env node
/**
 * Validate sub-agent LLM output (from Cursor subagent, not OpenAI API) using golden assertions.
 *
 * Usage:
 *   node scripts/assert-subagent-output.js s1 <output.txt> --test 01-batchcampaign-iud.yaml
 *   node scripts/assert-subagent-output.js s3 <output.txt> --test 01-good-reference.yaml
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '..', 'Assignment', 'package.json'));
const yaml = require('yaml');
const ROOT = path.join(__dirname, '..', 'Assignment');

const AGENTS = {
  s1: {
    name: 'spec-parser',
    assertions: '../Assignment/agents/spec-parser/evals/assertions/specParser.cjs',
    testsDir: '../Assignment/agents/spec-parser/evals/tests',
    fns: ['assertSchemaCompliance', 'assertFieldCompleteness', 'assertPkExtraction'],
  },
  s2: {
    name: 'trigger-codegen',
    assertions: '../Assignment/agents/trigger-codegen/evals/assertions/triggerCodegen.cjs',
    testsDir: '../Assignment/agents/trigger-codegen/evals/tests',
    fns: ['assertStructuralContract', 'assertDynamicEnqueue', 'assertForbiddenPatterns'],
  },
  s3: {
    name: 'trigger-review',
    assertions: '../Assignment/agents/trigger-review/evals/assertions/triggerReview.cjs',
    testsDir: '../Assignment/agents/trigger-review/evals/tests',
    fns: ['assertCommandDetection', 'assertStructureChecklist', 'assertForbiddenPatterns'],
  },
  s4: {
    name: 'remediator',
    assertions: '../Assignment/agents/remediator/evals/assertions/remediator.cjs',
    testsDir: '../Assignment/agents/remediator/evals/tests',
    fns: ['assertFixesApplied', 'assertNoForbiddenPatterns', 'assertStructuralContract'],
  },
};

function parseArgs(argv) {
  const agent = argv[0];
  const outputPath = argv[1];
  let testFile = null;
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--test' && argv[i + 1]) testFile = argv[++i];
  }
  return { agent, outputPath, testFile };
}

function main() {
  const { agent, outputPath, testFile } = parseArgs(process.argv.slice(2));
  const cfg = AGENTS[agent];
  if (!cfg) {
    console.error(`Unknown agent: ${agent}. Use s1|s2|s3|s4`);
    process.exit(2);
  }
  if (!outputPath || !testFile) {
    console.error('Usage: node assert-subagent-output.js <s1|s2|s3|s4> <output.txt> --test <file.yaml>');
    process.exit(2);
  }

  const output = fs.readFileSync(path.resolve(outputPath), 'utf8');
  const testPath = path.join(path.resolve(__dirname, cfg.testsDir), testFile);
  const testDoc = yaml.parse(fs.readFileSync(testPath, 'utf8'));
  const context = { vars: testDoc.vars ?? {} };

  const mod = require(path.resolve(__dirname, cfg.assertions));
  let failed = 0;
  for (const fn of cfg.fns) {
    if (typeof mod[fn] !== 'function') {
      console.error(`Missing assertion ${fn}`);
      failed += 1;
      continue;
    }
    const r = mod[fn](output, context);
    const pass = r?.pass ?? r?.grade ?? false;
    const mark = pass ? 'PASS' : 'FAIL';
    console.log(`  [${mark}] ${fn}: ${r?.reason ?? r?.message ?? ''}`);
    if (!pass) failed += 1;
  }

  process.exit(failed === 0 ? 0 : 1);
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}

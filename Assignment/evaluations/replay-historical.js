#!/usr/bin/env node
/** Replay saved artifacts. This performs no model inference and makes no runtime-readiness claim. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HISTORICAL = path.join(ROOT, 'historical');
const require = createRequire(path.join(ROOT, '..', 'package.json'));
const yaml = require('yaml');
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const agentDefinitions = {
  s1: ['spec-parser', ['schema_compliance', 'assertSchemaCompliance'], ['field_completeness', 'assertFieldCompleteness'], ['pk_extraction', 'assertPkExtraction']],
  s2: ['trigger-codegen', ['structural_contract', 'assertStructuralContract'], ['dynamic_enqueue', 'assertDynamicEnqueue'], ['forbidden_patterns', 'assertForbiddenPatterns']],
  s3: ['trigger-review', ['command_detection', 'assertCommandDetection'], ['structure_checklist', 'assertStructureChecklist'], ['forbidden_patterns', 'assertForbiddenPatterns']],
  s4: ['remediator', ['fixes_applied', 'assertFixesApplied'], ['no_forbidden_patterns', 'assertNoForbiddenPatterns'], ['structural_contract', 'assertStructuralContract']],
};
const assertionFiles = { s1: 'specParser.cjs', s2: 'triggerCodegen.cjs', s3: 'triggerReview.cjs', s4: 'remediator.cjs' };

export function replayHistorical() {
  const result = {
    evidence_type: 'deterministic_replay_of_saved_outputs',
    inference_performed: false,
    original_provider_claim: 'cursor:subagent',
    provenance_limitations: [
      'Original records do not include verified model IDs, response IDs, or inference usage.',
      'Original prompts and assertions are archived snapshots; results do not measure changed prompts or runtime.',
      'Stage 5 smoke checks do not establish full review coverage, semantic report faithfulness, or coordinator governance.',
    ],
    agents: {},
    stage5_smoke_checks: [],
  };
  for (const [id, [name, ...criteria]] of Object.entries(agentDefinitions)) {
    const testsDir = path.join(HISTORICAL, 'agents', name, 'evals', 'tests');
    const scorerPath = path.join(HISTORICAL, 'agents', name, 'evals', 'assertions', assertionFiles[id]);
    const assertions = require(scorerPath);
    const rows = fs.readdirSync(testsDir).filter((file) => file.endsWith('.yaml')).sort().map((test) => {
      const testPath = path.join(testsDir, test);
      const output = `${id}-${test.replace(/\.yaml$/, '.txt')}`;
      const outputPath = path.join(HISTORICAL, 'outputs', output);
      const context = { vars: yaml.parse(fs.readFileSync(testPath, 'utf8')).vars ?? {} };
      const text = fs.readFileSync(outputPath, 'utf8');
      const checks = criteria.map(([criterion, fn]) => {
        const value = assertions[fn](text, context);
        return { criterion, pass: Boolean(value.pass ?? value.grade), reason: value.reason ?? value.message ?? '' };
      });
      return { test, output, test_sha256: hash(testPath), output_sha256: hash(outputPath), checks, pass: checks.every((check) => check.pass) };
    });
    result.agents[id] = {
      workflow: name,
      scorer_sha256: hash(scorerPath),
      tests: rows.length,
      passed: rows.filter((row) => row.pass).length,
      criteria: criteria.map(([name]) => ({ name, evaluated: rows.length, passed: rows.filter((row) => row.checks.find((check) => check.criterion === name).pass).length })),
      rows,
    };
  }
  const read = (name) => fs.readFileSync(path.join(HISTORICAL, 'outputs', name), 'utf8');
  const parse = (text) => JSON.parse(text.trim().match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text);
  for (const [file, expected] of [['w5-upheld-good-pass.txt', 'UPHELD'], ['w5-overturn-missing-source.txt', 'OVERTURNED']]) {
    const value = parse(read(file));
    const pass = value.challenge === expected && Array.isArray(value.findings) && value.recommended_verdict === (expected === 'UPHELD' ? 'PASS' : 'FAIL');
    result.stage5_smoke_checks.push({ output: file, criterion: 'original_schema_and_expected_challenge_smoke_check', pass, output_sha256: hash(path.join(HISTORICAL, 'outputs', file)) });
  }
  const writer = read('w6-synthesis-pass.txt');
  result.stage5_smoke_checks.push({ output: 'w6-synthesis-pass.txt', criterion: 'original_writer_format_smoke_check', pass: !/^#/m.test(writer) && writer.split(/\n\s*\n/).filter((p) => p.trim()).length <= 4 && !/new violation|previously undetected/i.test(writer), limitations: 'Original scorer allowed four paragraphs despite a three-paragraph prompt; its phrase check does not verify no_new_findings or artifact coverage.' });
  const coordinator = parse(read('coordinator-c1-overturn.txt'));
  result.stage5_smoke_checks.push({ output: 'coordinator-c1-overturn.txt', criterion: 'original_expected_next_tool_smoke_check', pass: (coordinator.name ?? coordinator.tool ?? coordinator.function?.name) === 'launch_remediator', limitations: 'One supplied turn state is not an executed delegation workflow.' });
  result.overall = {
    tests: Object.values(result.agents).reduce((count, agent) => count + agent.tests, 0),
    passed: Object.values(result.agents).reduce((count, agent) => count + agent.passed, 0),
    smoke_checks_passed: result.stage5_smoke_checks.filter((row) => row.pass).length,
    smoke_checks: result.stage5_smoke_checks.length,
  };
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = replayHistorical();
  if (process.argv.includes('--write-results')) fs.writeFileSync(path.join(ROOT, 'historical-replay-results.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ evidence_type: result.evidence_type, ...result.overall }, null, 2));
  process.exitCode = result.overall.passed === result.overall.tests && result.overall.smoke_checks_passed === result.overall.smoke_checks ? 0 : 1;
}

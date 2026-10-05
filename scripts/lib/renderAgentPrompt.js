import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { fileURLToPath } from 'node:url';

const __libDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__libDir, '..', '..', 'Assignment', 'package.json'));
const yaml = require('yaml');

const AGENT_PROMPTS = {
  s1: 'agents/spec-parser/prompt/Prompt.md',
  s2: 'agents/trigger-codegen/prompt/Prompt.md',
  s3: 'agents/trigger-review/prompt/Prompt.md',
  s4: 'agents/remediator/prompt/Prompt.md',
  w5: 'agents/adversarial-review/prompt/Prompt.md',
  w6: 'agents/delivery-report/prompt/Prompt.md',
  coordinator: 'coordinator/prompt/Prompt.md',
};

function stringifyVar(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

export function renderTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key) => stringifyVar(vars[key]));
}

export function loadTestVars(assignmentRoot, agentKey, testFileName) {
  const agents = {
    s1: 'agents/spec-parser/evals/tests',
    s2: 'agents/trigger-codegen/evals/tests',
    s3: 'agents/trigger-review/evals/tests',
    s4: 'agents/remediator/evals/tests',
  };
  const dir = agents[agentKey];
  if (!dir) throw new Error(`No tests dir for ${agentKey}`);
  const testPath = path.join(assignmentRoot, dir, testFileName);
  const doc = yaml.parse(fs.readFileSync(testPath, 'utf8'));
  return doc.vars ?? {};
}

export function renderAgentPrompt(assignmentRoot, agentKey, vars = {}) {
  const rel = AGENT_PROMPTS[agentKey];
  if (!rel) throw new Error(`Unknown agent ${agentKey}`);
  const template = fs.readFileSync(path.join(assignmentRoot, rel), 'utf8');
  return renderTemplate(template, vars);
}

export function listYamlTests(assignmentRoot, agentKey) {
  const dirs = {
    s1: 'agents/spec-parser/evals/tests',
    s2: 'agents/trigger-codegen/evals/tests',
    s3: 'agents/trigger-review/evals/tests',
    s4: 'agents/remediator/evals/tests',
  };
  const dir = path.join(assignmentRoot, dirs[agentKey]);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .sort();
}

export function outputFileName(agentKey, testFileName) {
  const base = testFileName.replace(/\.yaml$/, '');
  return `${agentKey}-${base}.txt`;
}

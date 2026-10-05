#!/usr/bin/env node
/**
 * Build subagent packet files (full rendered Prompt.md + vars) for S1–S4 tests.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  listYamlTests,
  loadTestVars,
  renderAgentPrompt,
  outputFileName,
} from './lib/renderAgentPrompt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const ASSIGNMENT = path.join(ROOT, 'Assignment');
const PACKETS = path.join(ROOT, 'support', 'subagent-evals', 'packets');

const INSTRUCTION = `---
Subagent inference packet (Level 5). No API key — you are the model.
Follow the SYSTEM PROMPT below exactly.
Reply with ONLY the agent artifact (raw JSON or SQL). No markdown fences, no explanation.
---

`;

for (const agent of ['s1', 's2', 's3', 's4']) {
  const agentDir = path.join(PACKETS, agent);
  fs.mkdirSync(agentDir, { recursive: true });
  for (const testFile of listYamlTests(ASSIGNMENT, agent)) {
    const vars = loadTestVars(ASSIGNMENT, agent, testFile);
    const body = renderAgentPrompt(ASSIGNMENT, agent, vars);
    const outName = outputFileName(agent, testFile).replace('.txt', '.md');
    fs.writeFileSync(path.join(agentDir, outName), `${INSTRUCTION}${body}`, 'utf8');
  }
}

console.log(`Wrote packets under ${PACKETS}`);

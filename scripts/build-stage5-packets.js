#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTestVars, renderAgentPrompt } from './lib/renderAgentPrompt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const ASSIGNMENT = path.join(ROOT, 'Assignment');
const PACKETS = path.join(ROOT, 'support', 'subagent-evals', 'packets');

const HEADER = `---
Subagent inference packet (Stage 5). No API key — Cursor subagent is the model.
Follow the prompt exactly. Output ONLY the specified artifact. No markdown fences.
---

`;

function write(relDir, name, body) {
  const dir = path.join(PACKETS, relDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), `${HEADER}${body}`, 'utf8');
}

const good = loadTestVars(ASSIGNMENT, 's3', '01-good-reference.yaml');
const missingSource = loadTestVars(ASSIGNMENT, 's3', '05-missing-source.yaml');

write('w5', 'w5-upheld-good-pass.md', renderAgentPrompt(ASSIGNMENT, 'w5', good));
write('w5', 'w5-overturn-missing-source.md', renderAgentPrompt(ASSIGNMENT, 'w5', missingSource));

const w6Base = fs.readFileSync(path.join(ASSIGNMENT, 'agents/delivery-report/prompt/Prompt.md'), 'utf8');
const w6Input = `
INPUT
- trigger.sql: PASS (contract-compliant BatchCampaign downstream trigger)
- review.json: verdict PASS, adversarial-eligible
- adversarial.json: { "challenge": "UPHELD", "recommended_verdict": "PASS" }
- coordinator: all gates clear; proceed to human handoff

Write the markdown body only (≤3 short paragraphs). No # headings.
`;
write('w6', 'w6-synthesis-pass.md', `${w6Base}\n${w6Input}`);

const coordBase = fs.readFileSync(path.join(ASSIGNMENT, 'coordinator/prompt/Prompt.md'), 'utf8');
const c1User = `
USER (turn state)
- W3 review.json verdict was PASS.
- W5 adversarial.json just returned: challenge=OVERTURNED, recommended_verdict=FAIL, findings cite direct queue INSERT.
- remediateCycles=0, substance gate Continue=true, P1 approved.
- Valid next tools: launch_remediator, launch_trigger_review, launch_adversarial_reviewer (not report).

Respond with ONE JSON tool call only, shape: {"name":"launch_*","arguments":{...}}
`;
write('coordinator', 'c1-adversarial-overturn.md', `${coordBase}\n${c1User}`);

console.log('Stage 5 packets written under support/subagent-evals/packets/{w5,w6,coordinator}');

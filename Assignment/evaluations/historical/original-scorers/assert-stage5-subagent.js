#!/usr/bin/env node
/**
 * Assert W5 / W6 / coordinator subagent outputs.
 * Usage: node scripts/assert-stage5-subagent.js <w5-upheld|w5-overturn|w6-pass|c1-overturn> <output.txt>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '..', 'Assignment', 'package.json'));

const CASES = {
  'w5-upheld': {
    expectChallenge: 'UPHELD',
  },
  'w5-overturn': {
    expectChallenge: 'OVERTURNED',
  },
  'w6-pass': {
    maxParagraphs: 4,
    forbidHeadings: true,
    forbidNewFinding: /new violation|previously undetected/i,
  },
  'c1-overturn': {
    expectTool: 'launch_remediator',
  },
};

function extractJson(text) {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1].trim() : trimmed;
  return JSON.parse(raw);
}

async function main() {
  const [caseId, outputPath] = process.argv.slice(2);
  const cfg = CASES[caseId];
  if (!cfg || !outputPath) {
    console.error('Usage: assert-stage5-subagent.js <case> <output.txt>');
    process.exit(2);
  }
  const text = fs.readFileSync(path.resolve(outputPath), 'utf8');
  let failed = 0;

  if (caseId.startsWith('w5-')) {
    const guardrailPath = path.join(
      __dirname,
      '..',
      'Assignment',
      'guardrails',
      'validate-adversarial-json.js',
    );
    const { validateAdversarialJson } = await import(pathToFileURL(guardrailPath).href);
    const data = extractJson(text);
    const v = validateAdversarialJson(data);
    console.log(`  [${v.pass ? 'PASS' : 'FAIL'}] validateAdversarialJson: ${v.findings.join('; ') || 'ok'}`);
    if (!v.pass) failed += 1;
    const ch = data.challenge;
    const ok = ch === cfg.expectChallenge;
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] challenge: expected ${cfg.expectChallenge}, got ${ch}`);
    if (!ok) failed += 1;
  } else if (caseId === 'w6-pass') {
    if (cfg.forbidHeadings && /^#/m.test(text)) {
      console.log('  [FAIL] w6: must not include # headings');
      failed += 1;
    } else {
      console.log('  [PASS] w6: no markdown headings');
    }
    const paras = text.split(/\n\s*\n/).filter((p) => p.trim());
    const okP = paras.length <= cfg.maxParagraphs;
    console.log(`  [${okP ? 'PASS' : 'FAIL'}] w6: paragraph count ${paras.length} (max ${cfg.maxParagraphs})`);
    if (!okP) failed += 1;
    const bad = cfg.forbidNewFinding.test(text);
    console.log(`  [${bad ? 'FAIL' : 'PASS'}] w6: no invented findings`);
    if (bad) failed += 1;
  } else if (caseId === 'c1-overturn') {
    const data = extractJson(text);
    const name = data.name || data.tool || data.function?.name;
    const ok = name === cfg.expectTool;
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] coordinator tool: expected ${cfg.expectTool}, got ${name}`);
    if (!ok) failed += 1;
  }

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

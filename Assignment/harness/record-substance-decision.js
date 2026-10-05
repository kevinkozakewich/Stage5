#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { recordSubstanceDecision } from './lib/substanceGate.js';

export function recordFromArgs(argv) {
  const options = { overridesPath: fileURLToPath(new URL('../delegation/substance-overrides.jsonl', import.meta.url)) };
  const names = {
    '--correlation-id': 'correlationId',
    '--decision': 'decision',
    '--reviewer': 'reviewer',
    '--report': 'reportPath',
    '--notes': 'notes',
    '--overrides': 'overridesPath',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = names[argv[index]];
    if (!name || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new Error('Usage: node harness/record-substance-decision.js --correlation-id ID --decision Continue|Reject --reviewer "Human name" --report FILE [--notes TEXT] [--overrides FILE]');
    }
    options[name] = argv[++index];
  }
  return recordSubstanceDecision(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const row = recordFromArgs(process.argv.slice(2));
    console.log(JSON.stringify({ correlation_id: row.correlation_id, decision: row.decision, reviewer: row.reviewer, report_hash: row.report_hash }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

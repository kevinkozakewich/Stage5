#!/usr/bin/env node
// G2 SQL sentinel on trigger.sql after S2 or S4

import path from 'path';
import { fileURLToPath } from 'url';
import { scanTriggerSql } from './lib/trigger-contract.js';
import { readTextFile, exitWithResult } from './lib/cli.js';

export function runSqlSentinel(sql) {
  const result = scanTriggerSql(sql);
  return {
    guardrail: 'G2',
    pass: result.pass,
    findings: result.findings,
  };
}

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node sql-sentinel.js <trigger.sql>');
    process.exit(2);
  }

  let sql;
  try {
    sql = readTextFile(filePath);
  } catch (err) {
    exitWithResult({
      guardrail: 'G2',
      pass: false,
      findings: [{ id: 'io-error', label: err.message, kind: 'error' }],
      file: path.resolve(filePath),
    });
    return;
  }

  exitWithResult({
    ...runSqlSentinel(sql),
    file: path.resolve(filePath),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

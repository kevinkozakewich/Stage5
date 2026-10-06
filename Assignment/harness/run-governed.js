#!/usr/bin/env node
// Custom JSONL inference bridge. It executes no inference CLI or shell command.
// One {type:"inference_request",request} is emitted; send one JSON response line
// {requestId,output,usage}. EOF halts without fabricating a completion.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGovernedSession } from './lib/governedDelegation.js';

export async function main(argv = process.argv.slice(2)) {
  const get = (name) => { const index = argv.indexOf(name); return index < 0 ? undefined : argv[index + 1]; };
  if (!get('--brief') || !get('--run-id')) throw new Error('Usage: node harness/run-governed.js --brief FILE --run-id ID [--run-dir DIR] [--audit-dir DIR] [--execution-mode MODE]');
  const session = createGovernedSession({ brief: readFileSync(resolve(get('--brief')), 'utf8'), runId: get('--run-id'),
    correlationId: get('--correlation-id'), runDir: get('--run-dir'), auditDir: get('--audit-dir'), executionMode: get('--execution-mode') });
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const lines = input[Symbol.asyncIterator]();
  for (let request = await session.nextRequest(); request; request = await session.nextRequest()) {
    process.stdout.write(JSON.stringify({ type: 'inference_request', request }) + '\n');
    const line = await lines.next();
    if (line.done) throw new Error('Inference transport closed with an outstanding request; run remains incomplete');
    const result = await session.submitResponse(JSON.parse(line.value));
    process.stdout.write(JSON.stringify({ type: 'response_accepted', result }) + '\n');
  }
  const result = session.snapshot();
  input.close();
  process.stdout.write(JSON.stringify({ type: 'complete', status: result.status, reason: result.reason, runDir: session.runDir, auditPath: session.auditPath }) + '\n');
  process.exitCode = result.status === 'pending_human' ? 2 : result.status === 'success' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}

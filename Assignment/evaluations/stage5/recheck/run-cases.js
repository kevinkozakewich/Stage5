import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { invokeNativeEvaluation } from '../native-cli-provider.js';
const root = path.dirname(fileURLToPath(import.meta.url));
const suite = JSON.parse(fs.readFileSync(path.join(root, 'cases.json'), 'utf8'));
const capturePath = path.join(root, 'captures.json');
const captures = fs.existsSync(capturePath) ? JSON.parse(fs.readFileSync(capturePath, 'utf8')).captures : [];
const indexes = process.argv.slice(2).map(Number);
if (indexes.some((i) => !Number.isInteger(i) || i < 1 || i > suite.cases.length)) throw new Error('Explicit case indexes must exist in the frozen suite');
for (const [i, item] of suite.cases.entries()) {
  if (indexes.length && !indexes.includes(i + 1)) continue;
  if (captures.some((x) => x.case_id === item.id)) throw new Error(`Refusing to replace captured case ${item.id}`);
  const packet = fs.readFileSync(path.join(root, item.packet), 'utf8');
  const directory = `raw/case-${String(i + 1).padStart(2, '0')}`;
  const response = await invokeNativeEvaluation({ packet, outputDir: path.join(root, directory) });
  const capture = {
    case_id: item.id, provider: response.provider, invocation: response.invocation,
    thread_id: response.threadId, response_id: response.responseId, response_ids: response.responseIds, model: response.model,
    prompt_sha256: item.prompt_sha256, packet_sha256: response.packet_sha256, raw_sha256: response.raw_sha256,
    raw_directory: directory, raw_path: `${directory}/output.txt`, telemetry_path: `${directory}/telemetry.json`, events_path: `${directory}/events.jsonl`,
    attempt: response.attempt, manual_corrections: response.manual_corrections, host_tool_calls: response.host_tool_calls,
    token_usage: response.usage, cost_usd: response.cost_usd, cost_status: response.cost_status, standard_credit_equivalent: response.standard_credit_equivalent,
  };
  captures.push(capture);
  fs.writeFileSync(capturePath, JSON.stringify({ schema_version: 1, captures }, null, 2) + '\n');
  console.log(JSON.stringify({ case_id: item.id, thread_id: capture.thread_id, model: capture.model, captured: true }));
}

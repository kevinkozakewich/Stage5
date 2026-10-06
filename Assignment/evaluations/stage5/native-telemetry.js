import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_FIELDS = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'];
export const CREDIT_RATE_SOURCE = 'https://learn.chatgpt.com/docs/pricing';
// Standard-speed credit equivalents, not subscription usage or a dollar bill.
// Rates verified against the official page on 2026-10-05. Unknown models stay unknown.
export const STANDARD_CREDIT_RATES = Object.freeze({
  'gpt-6-astra': Object.freeze({ input: 250, cached_input: 25, output: 1250 }),
  'gpt-6.1-sol': Object.freeze({ input: 50, cached_input: 2.5, output: 250 }),
  'gpt-6-sol': Object.freeze({ input: 50, cached_input: 5, output: 250 }),
  'gpt-6-luna': Object.freeze({ input: 2.5, cached_input: 0.25, output: 12.5 }),
  'gpt-5.6-sol': Object.freeze({ input: 100, cached_input: 10, output: 500 }),
  'gpt-5.6-terra': Object.freeze({ input: 50, cached_input: 5, output: 300 }),
  'gpt-5.6-luna': Object.freeze({ input: 5, cached_input: 0.5, output: 30 }),
});

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const emptyUsage = () => Object.fromEntries(TOKEN_FIELDS.map((field) => [field, 0]));

function checkedUsage(usage) {
  const value = {};
  for (const field of TOKEN_FIELDS) {
    // Older native hosts may omit cache-write counts; do not invent a zero.
    value[field] = usage?.[field] ?? null;
    if (value[field] !== null && (!Number.isSafeInteger(value[field]) || value[field] < 0)) {
      throw new Error(`Invalid native usage field: ${field}`);
    }
  }
  for (const field of ['input_tokens', 'output_tokens', 'total_tokens']) {
    if (value[field] === null) throw new Error(`Missing native usage field: ${field}`);
  }
  if (value.input_tokens + value.output_tokens !== value.total_tokens) throw new Error('Native token total does not reconcile');
  if (value.cached_input_tokens > value.input_tokens || value.reasoning_output_tokens > value.output_tokens) {
    throw new Error('Native token subset exceeds its total');
  }
  return value;
}

function sumUsage(records) {
  const totals = emptyUsage();
  for (const { usage } of records) {
    for (const field of TOKEN_FIELDS) {
      totals[field] = totals[field] === null || usage[field] === null ? null : totals[field] + usage[field];
      if (totals[field] !== null && !Number.isSafeInteger(totals[field])) throw new Error('Native token total exceeds safe integer precision');
    }
  }
  return totals;
}

export function estimateStandardCredits(records) {
  let value = 0;
  const unknownModels = new Set();
  const rates = {};
  let missingCachedUsage = false;
  for (const record of records) {
    const rate = STANDARD_CREDIT_RATES[record.model];
    if (!rate) { unknownModels.add(record.model ?? 'unknown'); continue; }
    rates[record.model] = rate;
    if (record.usage.cached_input_tokens === null) { missingCachedUsage = true; continue; }
    const { input_tokens: input, cached_input_tokens: cached, output_tokens: output } = record.usage;
    value += ((input - cached) * rate.input + cached * rate.cached_input + output * rate.output) / 1_000_000;
  }
  return {
    value: unknownModels.size || missingCachedUsage ? null : Number(value.toFixed(9)),
    unit: 'standard_credit_equivalent',
    status: unknownModels.size || missingCachedUsage ? 'unavailable_for_some_records' : 'estimate_only',
    rates_per_million_tokens: rates,
    unknown_models: [...unknownModels].sort(),
    missing_cached_input_usage: missingCachedUsage,
    source: CREDIT_RATE_SOURCE,
    rates_verified_on: '2026-10-05',
    basis: 'Standard-speed credit rate equivalent of measured tokens. Not actual credits consumed, included subscription allowance, API cost, or billed USD. No separate cache-write charge; output already includes reasoning.',
  };
}

function listRolloutFiles(sessionsRoot) {
  try {
    return execFileSync('rg', ['--files', '--hidden', sessionsRoot], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
      .split(/\r?\n/).filter(Boolean);
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Unable to enumerate native session filenames');
    // Filename-only fallback when ripgrep is not installed. Do not follow symlinks.
    const visit = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? visit(path) : entry.isFile() ? [path] : [];
    });
    return visit(sessionsRoot);
  }
}

function parseLines(path) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/);
  return lines.flatMap((raw, index) => {
    if (!raw.trim()) return [];
    try { return [{ record: JSON.parse(raw), line: index + 1, rawHash: sha256(raw) }]; }
    catch {
      if (index === lines.length - 1 && !text.endsWith('\n')) throw new Error('Native rollout is still being written; retry after turn completion');
      throw new Error(`Malformed native rollout JSON at line ${index + 1}`);
    }
  });
}

/**
 * Extract full native evaluation turns from explicitly authorized thread IDs.
 * Reads only rollout filenames ending in an exact requested UUID. Ancestor
 * token records copied into forks are excluded by payload.thread_id. Raw
 * conversations, account metadata, environment contents, and absolute source
 * paths never enter the result. notBefore selects whole turns by start time.
 */
export function extractNativeTelemetry({
  threadIds,
  sessionsRoot = join(homedir(), '.codex', 'sessions'),
  turnIds,
  notBefore,
  requireCompleted = true,
} = {}) {
  if (!Array.isArray(threadIds) || !threadIds.length || threadIds.some((id) => !UUID.test(id))) {
    throw new Error('Explicit native thread UUIDs are required');
  }
  if (turnIds && (!Array.isArray(turnIds) || !turnIds.length || turnIds.some((id) => !UUID.test(id)))) {
    throw new Error('turnIds must contain explicit turn UUIDs');
  }
  const boundary = notBefore === undefined ? null : Date.parse(notBefore);
  if (boundary !== null && !Number.isFinite(boundary)) throw new Error('notBefore must be an ISO timestamp');
  const wantedTurns = turnIds ? new Set(turnIds) : null;
  const foundTurns = new Set();
  const files = listRolloutFiles(sessionsRoot);
  const threads = [...new Set(threadIds)].map((threadId) => {
    const matches = files.filter((path) => basename(path).toLowerCase().endsWith(`-${threadId.toLowerCase()}.jsonl`));
    if (matches.length !== 1) throw new Error(`Expected one native rollout for thread ${threadId}; found ${matches.length}`);
    const source = basename(matches[0]);
    const lines = parseLines(matches[0]);
    if (!lines.some(({ record }) => record.type === 'session_meta' && record.payload?.id === threadId)) {
      throw new Error(`Native rollout identity mismatch for ${threadId}`);
    }
    const contexts = new Map();
    const starts = new Map();
    const completions = new Map();
    for (const line of lines) {
      const { record, rawHash } = line;
      const p = record.payload;
      if (record.type === 'turn_context' && p?.turn_id) {
        const old = contexts.get(p.turn_id);
        if (old && old.model !== p.model) throw new Error('Conflicting model metadata within native turn');
        contexts.set(p.turn_id, { model: p.model ?? null, timestamp: record.timestamp, source_line_sha256: rawHash });
      }
      if (record.type === 'event_msg' && p?.type === 'task_started') starts.set(p.turn_id, record.timestamp);
      if (record.type === 'event_msg' && p?.type === 'task_complete') {
        completions.set(p.turn_id, { timestamp: record.timestamp, source_line_sha256: rawHash });
      }
    }
    const responses = new Map();
    for (const { record, line, rawHash } of lines) {
      const p = record.payload;
      if (record.type !== 'token_usage_record' || p?.thread_id !== threadId) continue;
      if (wantedTurns && !wantedTurns.has(p.turn_id)) continue;
      const context = contexts.get(p.turn_id);
      const start = starts.get(p.turn_id) ?? context?.timestamp;
      if (boundary !== null && (!start || Date.parse(start) < boundary)) continue;
      if (!p.response_id || !p.turn_id) throw new Error('Native usage record lacks attribution identifiers');
      const response = {
        thread_id: p.thread_id, turn_id: p.turn_id, root_turn_id: p.root_turn_id ?? null,
        session_id: p.session_id ?? null, response_id: p.response_id, timestamp: record.timestamp,
        model: context?.model ?? null, usage: checkedUsage(p.usage), source_line: line,
        source_line_sha256: rawHash, model_context_sha256: context?.source_line_sha256 ?? null,
      };
      const existing = responses.get(p.response_id);
      if (existing) {
        if (JSON.stringify(existing.usage) !== JSON.stringify(response.usage) || existing.turn_id !== response.turn_id || existing.model !== response.model) {
          throw new Error('Conflicting native records for the same response ID');
        }
        continue;
      }
      responses.set(p.response_id, response);
    }
    const selected = [...responses.values()];
    if (!selected.length) throw new Error(`No attributable native usage records for thread ${threadId}`);
    const turns = [...new Set(selected.map((record) => record.turn_id))].map((turnId) => {
      foundTurns.add(turnId);
      const completion = completions.get(turnId);
      if (requireCompleted && !completion) throw new Error(`Native turn ${turnId} has not completed; retry after completion`);
      const records = selected.filter((record) => record.turn_id === turnId);
      return {
        turn_id: turnId, model: contexts.get(turnId)?.model ?? null,
        started_at: starts.get(turnId) ?? contexts.get(turnId)?.timestamp ?? null,
        completed_at: completion?.timestamp ?? null, completion_source_line_sha256: completion?.source_line_sha256 ?? null,
        complete: Boolean(completion), response_count: records.length, usage: sumUsage(records),
      };
    });
    return { thread_id: threadId, source, turns, responses: selected, response_count: selected.length, usage: sumUsage(selected) };
  });
  if (wantedTurns && [...wantedTurns].some((id) => !foundTurns.has(id))) throw new Error('Some requested native turn IDs have no usage records');
  const responses = threads.flatMap((thread) => thread.responses);
  const result = {
    schema_version: 1,
    provider: 'codex_native_rollout',
    scope: 'full_native_evaluation_turn_including_context_tools_and_wrapper_overhead',
    extracted_at: new Date().toISOString(),
    snapshot: threads.some((thread) => thread.turns.some((turn) => !turn.complete)),
    selection: { thread_ids: threads.map((thread) => thread.thread_id), turn_ids: turnIds ?? null, not_before: notBefore ?? null },
    threads,
    response_count: responses.length,
    totals: sumUsage(responses),
    cost_usd: null,
    cost_status: 'not_exposed_by_native_host',
    standard_credit_equivalent: estimateStandardCredits(responses),
    notes: [
      'Direct per-response token_usage_record values only; cumulative token_count and inherited ancestor usage are excluded.',
      'Source paths are reduced to basenames. Only allowlisted telemetry and SHA-256 fingerprints of source lines are archived.',
      'Native host usage is recorded telemetry, not a final bill. Re-extract after completion if the host supplies delayed records.',
    ],
  };
  return { ...result, evidence_sha256: sha256(JSON.stringify(result)) };
}

function main(args) {
  const options = { threadIds: [], turnIds: [] };
  let output;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!['--thread', '--turn', '--sessions-root', '--not-before', '--output'].includes(flag) || !args[i + 1]) {
      throw new Error('Usage: native-telemetry.js --thread UUID [--thread UUID] [--turn UUID] [--not-before ISO] [--sessions-root DIR] [--output FILE]');
    }
    const value = args[++i];
    if (flag === '--thread') options.threadIds.push(value);
    else if (flag === '--turn') options.turnIds.push(value);
    else if (flag === '--sessions-root') options.sessionsRoot = value;
    else if (flag === '--not-before') options.notBefore = value;
    else output = value;
  }
  if (!options.turnIds.length) delete options.turnIds;
  const result = extractNativeTelemetry(options);
  if (output) {
    mkdirSync(dirname(resolve(output)), { recursive: true });
    writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify({ output: basename(output), response_count: result.response_count, totals: result.totals, cost_usd: null, evidence_sha256: result.evidence_sha256 }));
  } else console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

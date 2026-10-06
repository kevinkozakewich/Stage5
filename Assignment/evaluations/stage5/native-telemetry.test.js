import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { extractNativeTelemetry } from './native-telemetry.js';

const THREAD = '11111111-1111-7111-8111-111111111111';
const PARENT = '22222222-2222-7222-8222-222222222222';
const TURN = '33333333-3333-7333-8333-333333333333';
const LATER = '44444444-4444-7444-8444-444444444444';
const usage = { input_tokens: 1000, cached_input_tokens: 600, cache_write_input_tokens: 0, output_tokens: 100, reasoning_output_tokens: 20, total_tokens: 1100 };
const row = (type, payload, timestamp = '2026-10-05T22:00:00.000Z') => ({ type, timestamp, payload });
const context = (turn = TURN, model = 'gpt-6-astra', timestamp) => row('turn_context', { turn_id: turn, model, private_setting: 'DO_NOT_ARCHIVE_CONTEXT' }, timestamp);
const record = (response = 'resp_one', turn = TURN, thread = THREAD, tokens = usage, timestamp) => row('token_usage_record', {
  thread_id: thread, turn_id: turn, session_id: PARENT, root_turn_id: TURN, response_id: response, usage: tokens,
  thread_token_usage: { input_tokens: 999999999 }, private_property: 'DO_NOT_ARCHIVE_PAYLOAD',
}, timestamp);
const complete = (turn = TURN, timestamp = '2026-10-05T22:01:00.000Z') => row('event_msg', { type: 'task_complete', turn_id: turn, last_agent_message: 'DO_NOT_ARCHIVE_ANSWER' }, timestamp);

function fixture(t, rows) {
  const base = resolve(tmpdir());
  const directory = mkdtempSync(join(base, 'native-telemetry-test-'));
  t.after(() => {
    const target = resolve(directory);
    assert.ok(target.startsWith(base + sep) && target !== base);
    rmSync(target, { recursive: true, force: true });
  });
  const own = [row('session_meta', { id: THREAD, creator_account_id: 'DO_NOT_ARCHIVE_ACCOUNT' }), ...rows];
  writeFileSync(join(directory, `rollout-2026-10-05T17-00-00-${THREAD}.jsonl`), own.map(JSON.stringify).join('\n') + '\n');
  // A non-matching chat is never parsed or used, even if its contents are invalid.
  writeFileSync(join(directory, `rollout-2026-10-05T17-00-00-${PARENT}.jsonl`), 'UNRELATED NON-JSON PRIVATE CHAT');
  return { sessionsRoot: directory, threadIds: [THREAD] };
}

test('attributes direct native records, deduplicates responses, and archives no raw private metadata', (t) => {
  const options = fixture(t, [
    context(), record('parent', TURN, PARENT), record(), record(),
    row('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 99999999 } } }), complete(),
  ]);
  const result = extractNativeTelemetry(options);
  assert.equal(result.response_count, 1);
  assert.deepEqual(result.totals, usage);
  assert.equal(result.threads[0].turns[0].model, 'gpt-6-astra');
  assert.equal(result.snapshot, false);
  assert.equal(result.cost_usd, null);
  assert.equal(result.cost_status, 'not_exposed_by_native_host');
  assert.equal(result.standard_credit_equivalent.value, 0.24);
  assert.match(result.threads[0].responses[0].source_line_sha256, /^[a-f0-9]{64}$/);
  assert.match(result.evidence_sha256, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(result).includes('DO_NOT_ARCHIVE'));
  assert.ok(!JSON.stringify(result).includes(options.sessionsRoot));
});

test('requires a completed turn and labels an explicitly requested live snapshot', (t) => {
  const options = fixture(t, [context(), record()]);
  assert.throws(() => extractNativeTelemetry(options), /has not completed/);
  const snapshot = extractNativeTelemetry({ ...options, requireCompleted: false });
  assert.equal(snapshot.snapshot, true);
  assert.equal(snapshot.threads[0].turns[0].completed_at, null);
});

test('time boundary selects whole new turns, not partial usage of an old turn', (t) => {
  const options = fixture(t, [
    context(), record(), record('late_old_turn', TURN, THREAD, usage, '2026-10-05T23:00:10.000Z'), complete(),
    context(LATER, 'gpt-6.1-sol', '2026-10-05T23:00:00.000Z'),
    record('new_turn', LATER, THREAD, usage, '2026-10-05T23:00:10.000Z'), complete(LATER, '2026-10-05T23:01:00.000Z'),
  ]);
  const result = extractNativeTelemetry({ ...options, notBefore: '2026-10-05T22:30:00.000Z' });
  assert.equal(result.response_count, 1);
  assert.equal(result.threads[0].turns[0].turn_id, LATER);
  assert.equal(result.standard_credit_equivalent.value, 0.0465);
  assert.equal(extractNativeTelemetry({ ...options, turnIds: [TURN] }).response_count, 2);
});

test('unknown models and missing cache counts preserve uncertainty', (t) => {
  const options = fixture(t, [context(TURN, 'future-model'), record(), complete()]);
  const result = extractNativeTelemetry(options);
  assert.equal(result.standard_credit_equivalent.value, null);
  assert.deepEqual(result.standard_credit_equivalent.unknown_models, ['future-model']);
  const missingCache = fixture(t, [context(), record('missing-cache', TURN, THREAD, { ...usage, cached_input_tokens: undefined, cache_write_input_tokens: undefined }), complete()]);
  const missing = extractNativeTelemetry(missingCache);
  assert.equal(missing.totals.cached_input_tokens, null);
  assert.equal(missing.totals.cache_write_input_tokens, null);
  assert.equal(missing.standard_credit_equivalent.value, null);
});

test('fails closed on conflicting response records or absent explicit IDs', (t) => {
  const options = fixture(t, [context(), record(), record('resp_one', TURN, THREAD, { ...usage, output_tokens: 101, total_tokens: 1101 }), complete()]);
  assert.throws(() => extractNativeTelemetry(options), /Conflicting native records/);
  assert.throws(() => extractNativeTelemetry({ ...options, threadIds: [] }), /Explicit native thread UUIDs/);
  assert.throws(() => extractNativeTelemetry({ ...options, threadIds: ['..'] }), /Explicit native thread UUIDs/);
});

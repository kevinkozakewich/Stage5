import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Append-only JSONL audit logger for workflow steps.
 */
export class AuditLogger {
  /**
   * @param {object} options
   * @param {string} options.runId
   * @param {string} [options.auditDir]
   */
  constructor({ runId, auditDir = 'audit' }) {
    this.runId = runId;
    this.auditDir = auditDir;
    this.logPath = join(auditDir, `${runId}.jsonl`);
    this.seq = 0;
    this.lastSeq = null;
    this.entries = [];

    mkdirSync(dirname(this.logPath), { recursive: true });
  }

  /**
   * @param {string|Buffer|object} payload
   * @returns {string}
   */
  static hash(payload) {
    const text =
      typeof payload === 'string'
        ? payload
        : Buffer.isBuffer(payload)
          ? payload
          : JSON.stringify(payload);
    const digest = createHash('sha256').update(text).digest('hex');
    return `sha256:${digest}`;
  }

  /**
   * @param {object} fields
   * @returns {object}
   */
  append(fields) {
    this.seq += 1;

    const entry = {
      run_id: this.runId,
      correlation_id: fields.correlation_id,
      seq: this.seq,
      step_id: fields.step_id,
      step_type: fields.step_type,
      agent: fields.agent,
      model: fields.model ?? 'mock:golden',
      input_tokens: fields.input_tokens ?? 0,
      output_tokens: fields.output_tokens ?? 0,
      cost_usd: fields.cost_usd ?? 0,
      input_hash: fields.input_hash ?? AuditLogger.hash(''),
      output_hash: fields.output_hash ?? AuditLogger.hash(''),
      output_ref: fields.output_ref ?? '',
      parent_seq: fields.parent_seq ?? this.lastSeq,
      status: fields.status ?? 'success',
      timestamp: fields.timestamp ?? new Date().toISOString(),
    };

    if (fields.detail !== undefined) {
      entry.detail = fields.detail;
    }
    if (fields.failure_origin_step !== undefined) {
      entry.failure_origin_step = fields.failure_origin_step;
    }

    appendFileSync(this.logPath, `${JSON.stringify(entry)}\n`, 'utf8');
    this.entries.push(entry);
    this.lastSeq = this.seq;
    return entry;
  }

  /** @returns {object[]} */
  getEntries() {
    return [...this.entries];
  }
}

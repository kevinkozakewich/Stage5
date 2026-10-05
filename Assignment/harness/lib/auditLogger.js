import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
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
    if (typeof runId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(runId)) {
      throw new Error('runId must be a non-empty safe filename');
    }
    this.runId = runId;
    this.auditDir = auditDir;
    this.logPath = join(auditDir, `${runId}.jsonl`);
    this.seq = 0;
    this.lastSeq = null;
    this.entries = [];

    mkdirSync(dirname(this.logPath), { recursive: true });
    this.refresh();
  }

  /** Resume sequence and parent links from disk, including after reopening a run. */
  refresh() {
    if (!existsSync(this.logPath)) return;
    const content = readFileSync(this.logPath, 'utf8');
    const rows = content.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
    for (let index = 0; index < rows.length; index += 1) {
      if (rows[index].run_id !== this.runId || rows[index].seq !== index + 1) {
        throw new Error('Existing audit log has invalid run identity or sequence');
      }
    }
    this.entries = rows;
    this.seq = rows.length;
    this.lastSeq = rows.at(-1)?.seq ?? null;
    this.needsNewline = content.length > 0 && !content.endsWith('\n');
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
          : JSON.stringify(payload) ?? '';
    const digest = createHash('sha256').update(text).digest('hex');
    return `sha256:${digest}`;
  }

  /**
   * @param {object} fields
   * @returns {object}
   */
  append(fields) {
    this.refresh();
    this.seq += 1;

    const entry = {
      // Retain usage provenance, pricing, and provider metadata supplied by callers.
      ...fields,
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
      usage_source: fields.usage_source ?? (String(fields.model).startsWith('mock:') ? 'fixture' : 'not_reported'),
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

    appendFileSync(this.logPath, `${this.needsNewline ? '\n' : ''}${JSON.stringify(entry)}\n`, 'utf8');
    this.needsNewline = false;
    this.entries.push(entry);
    this.lastSeq = this.seq;
    return entry;
  }

  /** @returns {object[]} */
  getEntries() {
    return [...this.entries];
  }
}

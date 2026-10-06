/**
 * G2 sentinel checks aligned with Level 3 triggerReview.js REQUIRED_ELEMENTS
 * and FORBIDDEN_PATTERNS (queue-bypass subset used between S2/S4 and S3).
 */

export const G2_REQUIRED_MARKERS = [
  {
    id: 'missing-nocount',
    label: 'SET NOCOUNT ON',
    element: 'SET NOCOUNT ON',
    test: (sql) => /set\s+nocount\s+on/i.test(sql),
  },
  {
    id: 'missing-prep-sp',
    label: 'ToGpmq_EnqueueRecordByTriggerPrep',
    element:
      'Dynamic column discovery (no hard-coded business column names like scm_id, cm_id in static SELECT lists)',
    test: (sql) => /ToGpmq_EnqueueRecordByTriggerPrep/i.test(sql),
  },
];

export const G2_FORBIDDEN_PATTERNS = [
  {
    id: 'direct-queue-insert',
    label:
      'Direct INSERT INTO DownstreamMigrationQueue that bypasses ToGpmq_EnqueueRecordByTriggerPrep + sp_executesql',
    forbiddenId: 'queue-bypass',
    test: (sql) => {
      if (!/INSERT\s+INTO\s+.*DownstreamMigrationQueue/i.test(sql)) return false;
      return !/ToGpmq_EnqueueRecordByTriggerPrep|sp_executesql/i.test(sql);
    },
  },
];

/**
 * @param {string} sql
 * @returns {{ pass: boolean, findings: Array<{ id: string, label: string, kind: 'missing' | 'forbidden' }> }}
 */
export function scanTriggerSql(sql) {
  const text = String(sql || '');
  const findings = [];

  for (const marker of G2_REQUIRED_MARKERS) {
    if (!marker.test(text)) {
      findings.push({ id: marker.id, label: marker.label, kind: 'missing' });
    }
  }

  for (const pattern of G2_FORBIDDEN_PATTERNS) {
    if (pattern.test(text)) {
      findings.push({ id: pattern.id, label: pattern.label, kind: 'forbidden' });
    }
  }

  return { pass: findings.length === 0, findings };
}

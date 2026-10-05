const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const strings = (value) => Array.isArray(value) && value.every(nonempty);

export const REVIEW_REQUIRED_ELEMENTS = [
  'SET NOCOUNT ON',
  'SET XACT_ABORT OFF',
  'Command detection block (inserted/deleted → RI/RU/RD)',
  'BEGIN TRY / BEGIN CATCH',
  'ToGpmq_LogTriggerError OR inline NAF.BaseLog insert in CATCH',
  "@Source = N'Trigger' OR source = N'Trigger' in queue insert",
  'IF XACT_STATE() = -1 rethrow pattern',
  'Dynamic column discovery (no hard-coded business column names like scm_id, cm_id in static SELECT lists)',
];

/** W3 JSON contract and verdict consistency, independent of source-file cross-checks. */
export function validateReviewJson(data) {
  if (!object(data)) return { pass: false, findings: ['Review output must be an object'] };
  const findings = [];
  if (!['PASS', 'FAIL'].includes(data.verdict)) findings.push('verdict must be PASS or FAIL');
  const command = data.command_detection;
  if (!object(command) || typeof command.correct !== 'boolean'
    || !['RI', 'RU', 'RD', 'N/A'].includes(command.expected) || !nonempty(command.notes)) {
    findings.push('command_detection requires correct boolean, expected RI/RU/RD/N/A, and notes text');
  }
  const checklist = data.structure_checklist;
  const checklistValid = object(checklist) && ['passed', 'failed', 'missing'].every((key) => strings(checklist[key]));
  if (!checklistValid) {
    findings.push('structure_checklist requires passed, failed, and missing string arrays');
  } else {
    const labels = [...checklist.passed, ...checklist.failed, ...checklist.missing];
    if (labels.length !== REVIEW_REQUIRED_ELEMENTS.length || new Set(labels).size !== labels.length
      || REVIEW_REQUIRED_ELEMENTS.some((label) => !labels.includes(label))) {
      findings.push('Every required checklist label must occur exactly once across passed/failed/missing');
    }
  }
  const forbidden = data.forbidden_patterns;
  if (!object(forbidden) || typeof forbidden.clean !== 'boolean' || !strings(forbidden.found)) {
    findings.push('forbidden_patterns requires clean boolean and found string array');
  } else if (forbidden.clean !== (forbidden.found.length === 0)) {
    findings.push('forbidden_patterns.clean must agree with whether found is empty');
  }
  if (!Array.isArray(data.violations)) {
    findings.push('violations must be an array');
  } else {
    const ids = new Set();
    for (const [index, item] of data.violations.entries()) {
      if (!object(item) || !nonempty(item.id) || !/^V[1-9]\d*$/.test(item.id)
        || !['critical', 'major', 'minor'].includes(item.severity) || !nonempty(item.detail) || !nonempty(item.fix)) {
        findings.push(`violations[${index}] requires id V1/V2/etc., severity, detail, and fix`);
      } else if (ids.has(item.id)) {
        findings.push(`Duplicate violation ID ${item.id}`);
      } else {
        ids.add(item.id);
      }
    }
  }
  if (data.verdict === 'PASS' && (command?.correct !== true || !checklistValid
    || checklist.failed.length > 0 || checklist.missing.length > 0 || forbidden?.clean !== true
    || !Array.isArray(data.violations) || data.violations.length > 0)) {
    findings.push('PASS requires correct command detection, a complete passed checklist, clean patterns, and no violations');
  }
  if (data.verdict === 'FAIL' && (!Array.isArray(data.violations) || data.violations.length === 0)) {
    findings.push('FAIL requires at least one concrete violation');
  }
  return { pass: findings.length === 0, findings };
}

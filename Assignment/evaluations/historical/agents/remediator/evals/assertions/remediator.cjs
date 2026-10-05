/**
 * Deterministic assertions for S4 Remediator.
 */

const {
  ELEMENT_ALIASES,
  FORBIDDEN_PATTERNS,
} = require('../../../trigger-review/evals/assertions/triggerReview.cjs');

const { analyzeTriggerSql: analyzeCodegen } = require('../../../trigger-codegen/evals/assertions/triggerCodegen.cjs');

function stripOutput(output) {
  if (output == null) return '';
  const text = String(output).trim();
  const fenced = text.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : text;
}

function parseReview(vars) {
  const raw = vars.review_json;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch (_) {
    return null;
  }
}

function normalizeList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

function elementPresentInSql(sql, element) {
  const text = String(sql);

  if (element.includes('Command detection')) {
    return (
      /IF\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+inserted/i.test(text) &&
      /IF\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+deleted/i.test(text)
    );
  }
  if (element.includes('Dynamic column discovery')) {
    const hasDynamic = /ToGpmq_EnqueueRecordByTriggerPrep|sp_executesql/i.test(text);
    const hasHardcoded = /\[(scm_id|cm_id)\]/i.test(text);
    return hasDynamic && !hasHardcoded;
  }
  if (element.includes('@Source')) {
    return (
      /@Source\s*=\s*N'Trigger'|source\s*=\s*N'Trigger'|ToGpmq_EnqueueRecordByTriggerPrep/i.test(text)
    );
  }
  if (element.includes('ToGpmq_LogTriggerError')) {
    return /ToGpmq_LogTriggerError|NAF\.BaseLog/i.test(text);
  }
  if (element.includes('BEGIN TRY')) {
    return /begin\s+try/i.test(text) && /begin\s+catch/i.test(text);
  }
  if (element.includes('XACT_STATE')) {
    return /XACT_STATE\(\)\s*=\s*-1/i.test(text);
  }
  if (element.includes('SET NOCOUNT')) {
    return /set\s+nocount\s+on/i.test(text);
  }
  if (element.includes('SET XACT_ABORT')) {
    return /set\s+xact_abort\s+off/i.test(text);
  }

  const aliases = ELEMENT_ALIASES[element] || [
    new RegExp(element.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
  ];
  return aliases.some((p) => p.test(text));
}

function getGroundTruth(context) {
  const vars = context?.vars || context?.test?.vars || {};
  const review = parseReview(vars);
  const checklist = review?.structure_checklist || {};
  let toResolve = vars.expected_resolved_elements;
  if (typeof toResolve === 'string' && toResolve.startsWith('[')) {
    toResolve = JSON.parse(toResolve);
  }
  toResolve = toResolve || [...normalizeList(checklist.failed), ...normalizeList(checklist.missing)];

  return {
    vars,
    review,
    inputSql: vars.trigger_sql || '',
    toResolve: normalizeList(toResolve),
    expectForbiddenClean: vars.expect_forbidden_clean !== false,
  };
}

function result(pass, score, reason) {
  return { pass: Boolean(pass), score: pass ? score : 0, reason };
}

function assertFixesApplied(output, context) {
  const truth = getGroundTruth(context);
  const sql = stripOutput(output);

  if (!sql) {
    return result(false, 0, 'Remediated SQL is empty');
  }

  if (truth.toResolve.length === 0) {
    return result(false, 0, 'Fixture missing expected_resolved_elements or review checklist failures');
  }

  const unresolved = truth.toResolve.filter((el) => !elementPresentInSql(sql, el));
  if (unresolved.length > 0) {
    return result(false, 0, `Fixes not applied for: ${unresolved.join('; ')}`);
  }

  const score = (truth.toResolve.length - unresolved.length) / truth.toResolve.length;
  return result(true, score, `Applied fixes for ${truth.toResolve.length} violation(s)`);
}

function scanForbidden(sql) {
  const forbiddenFound = [];
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (typeof pattern.detectInSql === 'function') {
      if (pattern.detectInSql(sql)) forbiddenFound.push(pattern.label);
      continue;
    }
    if (pattern.regex?.test(sql)) {
      if (pattern.allowedIf && pattern.allowedIf.test(sql)) continue;
      forbiddenFound.push(pattern.label);
    }
  }
  return forbiddenFound;
}

function assertNoForbiddenPatterns(output, context) {
  const truth = getGroundTruth(context);
  const sql = stripOutput(output);
  const forbiddenFound = scanForbidden(sql);

  if (forbiddenFound.length > 0) {
    return result(
      false,
      0,
      `Introduced or retained forbidden patterns: ${forbiddenFound.join('; ')}`
    );
  }

  const hasDirectQueue =
    /INSERT\s+INTO\s+.*DownstreamMigrationQueue/i.test(sql) &&
    !/ToGpmq_EnqueueRecordByTriggerPrep|sp_executesql/i.test(sql);
  if (hasDirectQueue) {
    return result(false, 0, 'Direct queue INSERT still present after remediation');
  }

  const hasUngatedThrow = (() => {
    const hasCatch = /BEGIN\s+CATCH/i.test(sql);
    const hasThrow = /\bTHROW\b/i.test(sql);
    const hasXactGate = /XACT_STATE\(\)\s*=\s*-1/i.test(sql);
    return hasCatch && hasThrow && !hasXactGate;
  })();
  if (hasUngatedThrow) {
    return result(false, 0, 'Ungated THROW in CATCH block');
  }

  return result(true, 1, 'No forbidden patterns in remediated SQL');
}

function assertStructuralContract(output, context) {
  const truth = getGroundTruth(context);
  const sql = stripOutput(output);
  const analysis = analyzeCodegen(sql, {});

  if (analysis.missingMarkers.length > 0) {
    return result(
      false,
      0,
      `Missing post-remediation markers: ${analysis.missingMarkers.join('; ')}`
    );
  }

  if (truth.inputSql && truth.vars.expect_preserve_trigger_name !== false) {
    const inputName = truth.inputSql.match(/TRIGGER\s+\[[^\]]+\]\.\[([^\]]+)\]/i);
    const outputName = sql.match(/TRIGGER\s+\[[^\]]+\]\.\[([^\]]+)\]/i);
    if (inputName && outputName && inputName[1] !== outputName[1]) {
      return result(false, 0, `Trigger name changed: ${inputName[1]} → ${outputName[1]}`);
    }
  }

  return result(true, 1, 'Post-remediation structural contract satisfied');
}

module.exports = {
  assertFixesApplied,
  assertNoForbiddenPatterns,
  assertStructuralContract,
  elementPresentInSql,
};

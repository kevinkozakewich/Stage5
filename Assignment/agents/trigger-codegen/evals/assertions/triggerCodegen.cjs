/**
 * Deterministic assertions for S2 Trigger Codegen structural contract.
 */

const {
  REQUIRED_ELEMENTS,
  FORBIDDEN_PATTERNS,
} = require('../../../trigger-review/evals/assertions/triggerReview.cjs');

const STRUCTURAL_MARKERS = [
  { id: 'nocount', label: 'SET NOCOUNT ON', test: (sql) => /set\s+nocount\s+on/i.test(sql) },
  { id: 'xact-abort', label: 'SET XACT_ABORT OFF', test: (sql) => /set\s+xact_abort\s+off/i.test(sql) },
  {
    id: 'trycatch',
    label: 'BEGIN TRY / BEGIN CATCH',
    test: (sql) => /begin\s+try/i.test(sql) && /begin\s+catch/i.test(sql),
  },
  {
    id: 'prep-sp',
    label: 'ToGpmq_EnqueueRecordByTriggerPrep',
    test: (sql) => /ToGpmq_EnqueueRecordByTriggerPrep/i.test(sql),
  },
  {
    id: 'dynamic-enqueue',
    label: 'sp_executesql dynamic enqueue',
    test: (sql) => /sp_executesql/i.test(sql),
  },
  {
    id: 'error-log',
    label: 'ToGpmq_LogTriggerError',
    test: (sql) => /ToGpmq_LogTriggerError/i.test(sql),
  },
  {
    id: 'xact-gate',
    label: 'IF XACT_STATE() = -1 rethrow',
    test: (sql) => /XACT_STATE\(\)\s*=\s*-1/i.test(sql),
  },
];

function parseRequirements(vars) {
  const raw = vars.requirements_json;
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch (_) {
    return null;
  }
}

function stripOutput(output) {
  if (output == null) return '';
  const text = String(output).trim();
  const fenced = text.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : text;
}

function analyzeTriggerSql(sql, requirements) {
  const text = stripOutput(sql);
  const missingMarkers = STRUCTURAL_MARKERS.filter((m) => !m.test(text)).map((m) => m.label);

  const forbiddenFound = [];
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (typeof pattern.detectInSql === 'function') {
      if (pattern.detectInSql(text)) forbiddenFound.push(pattern.label);
      continue;
    }
    if (pattern.regex?.test(text)) {
      if (pattern.allowedIf && pattern.allowedIf.test(text)) continue;
      forbiddenFound.push(pattern.label);
    }
  }

  const triggerType = requirements?.trigger_type || '';
  let commandOk = true;
  if (/AFTER INSERT, UPDATE, DELETE/i.test(triggerType)) {
    commandOk =
      /IF\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+inserted/i.test(text) &&
      /IF\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+deleted/i.test(text);
  } else if (/AFTER INSERT$/i.test(triggerType.trim())) {
    commandOk = /@Command\s*=\s*'RI'/i.test(text) || /IF\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+inserted/i.test(text);
  }

  const schema = requirements?.schema || 'PurinaNA';
  const table = requirements?.table || '';
  const tableRefOk =
    !table ||
    (new RegExp(`\\[${schema}\\]\\.\\[${table}\\]`, 'i').test(text) &&
      new RegExp(`${table}_DownstreamMigration`, 'i').test(text));

  return {
    text,
    missingMarkers,
    forbiddenFound,
    forbiddenClean: forbiddenFound.length === 0,
    commandOk,
    tableRefOk,
    markersPresent: STRUCTURAL_MARKERS.length - missingMarkers.length,
    markersTotal: STRUCTURAL_MARKERS.length,
  };
}

function getGroundTruth(context) {
  const vars = context?.vars || context?.test?.vars || {};
  const requirements = parseRequirements(vars);
  return {
    vars,
    requirements,
    expectCommandDetection:
      typeof vars.expect_command_detection === 'boolean' ? vars.expect_command_detection : true,
    expectTableRef: vars.expect_table_ref !== false,
    expectForbiddenClean: vars.expect_forbidden_clean !== false,
  };
}

function result(pass, score, reason) {
  return { pass: Boolean(pass), score: pass ? score : 0, reason };
}

function assertStructuralContract(output, context) {
  const truth = getGroundTruth(context);
  const analysis = analyzeTriggerSql(output, truth.requirements);

  if (!analysis.text) {
    return result(false, 0, 'Output SQL is empty');
  }

  if (analysis.missingMarkers.length > 0) {
    return result(
      false,
      0,
      `Missing structural markers: ${analysis.missingMarkers.join('; ')}`
    );
  }

  if (truth.expectTableRef && truth.requirements && !analysis.tableRefOk) {
    return result(false, 0, 'Trigger missing expected schema/table/trigger name references');
  }

  const score = analysis.markersPresent / analysis.markersTotal;
  return result(true, score, 'All structural contract markers present');
}

function assertDynamicEnqueue(output, context) {
  const truth = getGroundTruth(context);
  const analysis = analyzeTriggerSql(output, truth.requirements);
  const sql = analysis.text;

  const hasPrep = /ToGpmq_EnqueueRecordByTriggerPrep/i.test(sql);
  const hasExec = /sp_executesql/i.test(sql);
  const hasDirectQueue =
    /INSERT\s+INTO\s+.*DownstreamMigrationQueue/i.test(sql) &&
    !/ToGpmq_EnqueueRecordByTriggerPrep|sp_executesql/i.test(sql);

  if (!hasPrep || !hasExec) {
    return result(false, 0, 'Missing prep SP or sp_executesql dynamic enqueue path');
  }
  if (hasDirectQueue) {
    return result(false, 0, 'Direct queue INSERT bypass detected');
  }

  return result(true, 1, 'Dynamic enqueue via prep SP + sp_executesql');
}

function assertForbiddenPatterns(output, context) {
  const truth = getGroundTruth(context);
  const analysis = analyzeTriggerSql(output, truth.requirements);

  if (analysis.forbiddenClean !== truth.expectForbiddenClean) {
    return result(
      false,
      0,
      `Expected forbidden clean=${truth.expectForbiddenClean}, found: ${analysis.forbiddenFound.join(', ') || '(none)'}`
    );
  }

  if (truth.expectCommandDetection && truth.requirements) {
    const triggerType = truth.requirements.trigger_type || '';
    if (/AFTER INSERT, UPDATE, DELETE/i.test(triggerType) && !analysis.commandOk) {
      return result(false, 0, 'Full IUD trigger missing inserted/deleted command detection');
    }
  }

  return result(true, 1, 'No forbidden patterns; command detection OK');
}

module.exports = {
  assertStructuralContract,
  assertDynamicEnqueue,
  assertForbiddenPatterns,
  analyzeTriggerSql,
  STRUCTURAL_MARKERS,
  REQUIRED_ELEMENTS,
};

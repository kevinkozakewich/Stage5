/**
 * Deterministic assertions for DMO downstream migration trigger review.
 * Checks JSON output against fixture ground truth.
 * Maps to REVIEW PROCEDURE Step 1 (command detection), Step 2 (structure checklist),
 * Step 3 (forbidden patterns).
 */

const REQUIRED_ELEMENTS = [
  'SET NOCOUNT ON',
  'SET XACT_ABORT OFF',
  'Command detection block (inserted/deleted → RI/RU/RD)',
  'BEGIN TRY / BEGIN CATCH',
  'ToGpmq_LogTriggerError OR inline NAF.BaseLog insert in CATCH',
  "@Source = N'Trigger' OR source = N'Trigger' in queue insert",
  'IF XACT_STATE() = -1 rethrow pattern',
  'Dynamic column discovery (no hard-coded business column names like scm_id, cm_id in static SELECT lists)',
];

const ELEMENT_ALIASES = {
  'SET NOCOUNT ON': [/set\s+nocount\s+on/i],
  'SET XACT_ABORT OFF': [/set\s+xact_abort\s+off/i],
  'Command detection block (inserted/deleted → RI/RU/RD)': [
    /command detection block/i,
    /IF\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+inserted/i,
    /IF\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+deleted/i,
    /@Command\s*=\s*'R[UID]'/i,
  ],
  'BEGIN TRY / BEGIN CATCH': [/begin\s+try/i, /begin\s+catch/i],
  'ToGpmq_LogTriggerError OR inline NAF.BaseLog insert in CATCH': [
    /ToGpmq_LogTriggerError/i,
    /NAF\.BaseLog/i,
    /BaseLog/i,
  ],
  "@Source = N'Trigger' OR source = N'Trigger' in queue insert": [
    /@Source\s*=\s*N'Trigger'/i,
    /source\s*=\s*N'Trigger'/i,
    /@Source.*Trigger/i,
  ],
  'IF XACT_STATE() = -1 rethrow pattern': [
    /XACT_STATE\(\)\s*=\s*-1/i,
    /xact_state.*-1.*throw/i,
  ],
  'Dynamic column discovery (no hard-coded business column names like scm_id, cm_id in static SELECT lists)': [
    /dynamic column/i,
    /no hard-coded/i,
    /column discovery/i,
    /sp_executesql/i,
    /ToGpmq_EnqueueRecordByTriggerPrep/i,
  ],
};

// Step 3 forbidden patterns, same four as Prompt.md
const FORBIDDEN_PATTERNS = [
  {
    id: 'queue-bypass',
    label:
      'Direct INSERT INTO DownstreamMigrationQueue that bypasses ToGpmq_EnqueueRecordByTriggerPrep + sp_executesql',
    regex: /INSERT\s+INTO\s+.*DownstreamMigrationQueue/i,
    allowedIf: /ToGpmq_EnqueueRecordByTriggerPrep|sp_executesql/i,
  },
  {
    id: 'hardcoded-columns',
    label:
      'Hard coded business column names like [scm_id], [cm_id], etc. in static SQL outside the dynamic discovery path',
    regex: /\[(scm_id|cm_id|batch_id|campaign_id)\]/i,
  },
  {
    id: 'ungated-catch-rethrow',
    label: 'CATCH block that rethrows on all errors without gating on XACT_STATE() = -1',
    detectInSql: (sql) => {
      const hasCatch = /BEGIN\s+CATCH/i.test(sql);
      if (!hasCatch) return false;
      const hasThrow = /\bTHROW\b/i.test(sql);
      const hasXactGate = /XACT_STATE\(\)\s*=\s*-1/i.test(sql);
      return hasThrow && !hasXactGate;
    },
  },
  {
    id: 'missing-source',
    label: "Missing @Source = N'Trigger' on the enqueue path",
    detectInSql: (sql) => {
      const hasEnqueue =
        /DownstreamMigrationQueue|ToGpmq_EnqueueRecord/i.test(sql) &&
        !/ToGpmq_EnqueueRecordByTriggerPrep/i.test(sql);
      if (!hasEnqueue) return false;
      return !/@Source\s*=\s*N'Trigger'|source\s*=\s*N'Trigger'/i.test(sql);
    },
  },
];

/**
 * Parse model output as JSON, stripping markdown code fences when present.
 * @param {string} output
 * @returns {{ data: object | null, error: string | null }}
 */
function parseModelOutput(output) {
  if (output == null) {
    return { data: null, error: 'Output is empty' };
  }

  const text = String(output).trim();
  if (!text) {
    return { data: null, error: 'Output is empty' };
  }

  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : text;

  try {
    const data = JSON.parse(candidate);
    return { data, error: null };
  } catch (err) {
    const jsonLike = candidate.match(/\{[\s\S]*\}/);
    if (jsonLike) {
      try {
        return { data: JSON.parse(jsonLike[0]), error: null };
      } catch (innerErr) {
        return { data: null, error: `Invalid JSON: ${innerErr.message}` };
      }
    }
    return { data: null, error: `Invalid JSON: ${err.message}` };
  }
}

function normalizeList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

function listsContainElement(lists, element) {
  const haystack = lists.flat().join('\n').toLowerCase();
  const aliases = ELEMENT_ALIASES[element] || [new RegExp(element.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')];
  return aliases.some((pattern) => {
    if (pattern instanceof RegExp) return pattern.test(haystack);
    return haystack.includes(String(pattern).toLowerCase());
  });
}

function elementMentionedInChecklist(checklist, element) {
  const passed = normalizeList(checklist?.passed);
  const failed = normalizeList(checklist?.failed);
  const missing = normalizeList(checklist?.missing);
  return (
    listsContainElement([passed], element) ||
    listsContainElement([failed], element) ||
    listsContainElement([missing], element)
  );
}

function analyzeTriggerSql(triggerSql) {
  const sql = String(triggerSql || '');
  const presentElements = REQUIRED_ELEMENTS.filter((element) => {
    const patterns = ELEMENT_ALIASES[element] || [];
    if (element.includes('Command detection')) {
      return /IF\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+inserted/i.test(sql) &&
        /IF\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+deleted/i.test(sql);
    }
    if (element.includes('Dynamic column discovery')) {
      const hasDynamic = /ToGpmq_EnqueueRecordByTriggerPrep|sp_executesql|sys\.columns|INFORMATION_SCHEMA\.COLUMNS/i.test(sql);
      const hasHardcoded = /\[(scm_id|cm_id)\]/i.test(sql);
      return hasDynamic && !hasHardcoded;
    }
    if (element.includes("@Source")) {
      return /@Source\s*=\s*N'Trigger'|source\s*=\s*N'Trigger'|ToGpmq_EnqueueRecordByTriggerPrep/i.test(sql);
    }
    if (element.includes('ToGpmq_LogTriggerError')) {
      return /ToGpmq_LogTriggerError|NAF\.BaseLog/i.test(sql);
    }
    return patterns.some((p) => p.test(sql));
  });

  const missingElements = REQUIRED_ELEMENTS.filter((el) => !presentElements.includes(el));

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

  return { presentElements, missingElements, forbiddenFound, forbiddenClean: forbiddenFound.length === 0 };
}

function parseExpectedFailedElements(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch (_) {
        /* fall through */
      }
    }
    return [value];
  }
  return [String(value)];
}

function getGroundTruth(context) {
  const vars = context?.vars || context?.test?.vars || {};
  const triggerSql = vars.trigger_sql || '';
  const analysis = analyzeTriggerSql(triggerSql);

  const expectedVerdict = vars.expected_verdict || (analysis.missingElements.length === 0 && analysis.forbiddenClean ? 'PASS' : 'FAIL');
  const expectForbiddenClean =
    typeof vars.expect_forbidden_clean === 'boolean' ? vars.expect_forbidden_clean : analysis.forbiddenClean;

  const expectedFailedElements =
    vars.expected_failed_elements != null
      ? parseExpectedFailedElements(vars.expected_failed_elements)
      : expectedVerdict === 'FAIL'
        ? analysis.missingElements
        : [];

  return {
    vars,
    analysis,
    expectedVerdict,
    expectedCommand: vars.expected_command,
    expectedFailedElements: normalizeList(expectedFailedElements),
    expectForbiddenClean,
  };
}

function result(pass, score, reason) {
  return { pass: Boolean(pass), score: pass ? score : 0, reason };
}

/**
 * Step 1 command_detection vs fixture expected command
 */
function assertCommandDetection(output, context) {
  const { data, error } = parseModelOutput(output);
  if (error) return result(false, 0, error);

  const truth = getGroundTruth(context);
  const cd = data.command_detection;
  if (!cd || typeof cd !== 'object') {
    return result(false, 0, 'Missing command_detection object in model output');
  }

  const expected = truth.expectedCommand;
  if (!expected) {
    return result(false, 0, 'Fixture missing vars.expected_command');
  }

  const expectedMatch = String(cd.expected || '').toUpperCase() === String(expected).toUpperCase();
  const commandDetectionFailed = normalizeList(truth.expectedFailedElements).some((el) =>
    /command detection/i.test(el)
  );
  const expectCorrect =
    typeof truth.vars.expect_command_correct === 'boolean'
      ? truth.vars.expect_command_correct
      : !commandDetectionFailed;

  if (!expectedMatch) {
    return result(false, 0, `Expected command ${expected}, model reported ${cd.expected}`);
  }
  if (cd.correct !== expectCorrect) {
    return result(
      false,
      0,
      `Expected command_detection.correct=${expectCorrect}, got ${cd.correct}; notes: ${cd.notes || '(none)'}`
    );
  }

  return result(true, 1, `Command detection as expected (${expected}, correct=${expectCorrect})`);
}

/**
 * Step 2 structure_checklist uses REQUIRED ELEMENTS labels
 */
function assertStructureChecklist(output, context) {
  const { data, error } = parseModelOutput(output);
  if (error) return result(false, 0, error);

  const truth = getGroundTruth(context);
  const checklist = data.structure_checklist || {};
  const passed = normalizeList(checklist.passed);
  const failed = normalizeList(checklist.failed);
  const missing = normalizeList(checklist.missing);

  if (truth.expectedVerdict === 'PASS') {
    for (const element of REQUIRED_ELEMENTS) {
      if (!elementMentionedInChecklist(checklist, element)) {
        return result(false, 0, `PASS fixture: required element not mentioned in checklist: ${element}`);
      }
      if (listsContainElement([failed], element) || listsContainElement([missing], element)) {
        return result(false, 0, `PASS fixture: element incorrectly marked failed/missing: ${element}`);
      }
    }
    return result(true, 1, 'All required structural elements present');
  }

  if (data.verdict !== 'FAIL') {
    return result(false, 0, `FAIL fixture: expected verdict FAIL, got ${data.verdict}`);
  }

  if (truth.expectedFailedElements.length === 0) {
    return result(true, 1, 'FAIL fixture: verdict FAIL with structural findings');
  }

  for (const element of truth.expectedFailedElements) {
    const inFailedOrMissing =
      listsContainElement([failed], element) || listsContainElement([missing], element);
    if (!inFailedOrMissing) {
      return result(
        false,
        0,
        `FAIL fixture: expected violation not in failed/missing: ${element}`
      );
    }
  }

  const falsePasses = REQUIRED_ELEMENTS.filter(
    (element) =>
      truth.analysis.missingElements.includes(element) &&
      listsContainElement([passed], element)
  );
  if (falsePasses.length > 0) {
    return result(false, 0, `Incorrectly marked as passed: ${falsePasses.join('; ')}`);
  }

  return result(true, 1, 'Structure checklist correctly identifies violations');
}

/**
 * Step 3 forbidden_patterns.clean vs ground truth
 */
function assertForbiddenPatterns(output, context) {
  const { data, error } = parseModelOutput(output);
  if (error) return result(false, 0, error);

  const truth = getGroundTruth(context);
  const fp = data.forbidden_patterns;
  if (!fp || typeof fp !== 'object') {
    return result(false, 0, 'Missing forbidden_patterns object in model output');
  }

  if (typeof fp.clean !== 'boolean') {
    return result(false, 0, 'forbidden_patterns.clean must be boolean');
  }

  if (fp.clean !== truth.expectForbiddenClean) {
    return result(
      false,
      0,
      `Expected forbidden_patterns.clean=${truth.expectForbiddenClean}, got ${fp.clean}`
    );
  }

  const found = normalizeList(fp.found);
  if (!truth.expectForbiddenClean && found.length === 0) {
    return result(false, 0, 'FAIL fixture: forbidden_patterns.found should list violations');
  }

  if (truth.expectForbiddenClean && found.length > 0) {
    return result(false, 0, `PASS fixture: unexpected forbidden patterns found: ${found.join(', ')}`);
  }

  return result(true, 1, `Forbidden pattern scan clean=${fp.clean}`);
}

module.exports = {
  parseModelOutput,
  assertCommandDetection,
  assertStructureChecklist,
  assertForbiddenPatterns,
  assertE1CommandDetection: assertCommandDetection,
  assertE2StructureChecklist: assertStructureChecklist,
  assertE3ForbiddenPatterns: assertForbiddenPatterns,
  REQUIRED_ELEMENTS,
  FORBIDDEN_PATTERNS,
};

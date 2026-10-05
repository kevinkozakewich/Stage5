/**
 * Deterministic assertions for S1 Spec Parser.
 * Maps to parsing procedure steps 1 through 5
 */

const schema = require('../../../../guardrails/lib/requirements-schema.json');

const TRIGGER_TYPES = [
  'AFTER INSERT',
  'AFTER UPDATE',
  'AFTER DELETE',
  'AFTER INSERT, UPDATE, DELETE',
];

function typeOf(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function validateString(value, spec, fieldPath, errors) {
  if (typeOf(value) !== 'string') {
    errors.push(`${fieldPath}: expected string, got ${typeOf(value)}`);
    return;
  }
  if (spec.minLength != null && value.length < spec.minLength) {
    errors.push(`${fieldPath}: must be at least ${spec.minLength} character(s)`);
  }
  if (spec.enum && !spec.enum.includes(value)) {
    errors.push(`${fieldPath}: must be one of ${spec.enum.join(', ')}`);
  }
}

function validateObject(value, spec, fieldPath, errors) {
  if (typeOf(value) !== 'object' || value === null || Array.isArray(value)) {
    errors.push(`${fieldPath}: expected object, got ${typeOf(value)}`);
    return;
  }
  if (spec.required) {
    for (const key of spec.required) {
      if (!(key in value)) {
        errors.push(`${fieldPath}: missing required property "${key}"`);
      }
    }
  }
  if (spec.properties) {
    for (const [key, propSpec] of Object.entries(spec.properties)) {
      if (!(key in value)) continue;
      validateValue(value[key], propSpec, `${fieldPath}.${key}`, errors);
    }
  }
}

function validateOneOf(value, spec, fieldPath, errors) {
  for (const branch of spec.oneOf) {
    const branchErrs = [];
    validateValue(value, branch, fieldPath, branchErrs);
    if (branchErrs.length === 0) return;
  }
  errors.push(
    `${fieldPath}: must match one of the allowed pk shapes (non-empty string or non-empty string array)`
  );
}

function validateValue(value, spec, fieldPath, errors) {
  if (spec.oneOf) {
    validateOneOf(value, spec, fieldPath, errors);
    return;
  }
  if (spec.type === 'object') {
    validateObject(value, spec, fieldPath, errors);
    return;
  }
  if (spec.type === 'string') {
    validateString(value, spec, fieldPath, errors);
    return;
  }
  if (spec.type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${fieldPath}: expected array, got ${typeOf(value)}`);
      return;
    }
    if (spec.minItems != null && value.length < spec.minItems) {
      errors.push(`${fieldPath}: must contain at least ${spec.minItems} item(s)`);
    }
    if (spec.items) {
      value.forEach((item, index) => validateValue(item, spec.items, `${fieldPath}[${index}]`, errors));
    }
  }
}

function validateRequirements(data) {
  const errors = [];
  validateObject(data, schema, 'requirements', errors);
  return errors;
}

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
    return { data: JSON.parse(candidate), error: null };
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

function normalizePk(pk) {
  if (Array.isArray(pk)) return pk.map(String);
  if (pk == null) return [];
  return [String(pk)];
}

function getGroundTruth(context) {
  const vars = context?.vars || context?.test?.vars || {};
  return {
    vars,
    expectedTable: vars.expected_table,
    expectedSchema: vars.expected_schema,
    expectedPk: vars.expected_pk,
    expectedTriggerType: vars.expected_trigger_type,
    expectSchema: vars.expect_schema !== false,
    expectedConstraints: vars.expected_constraints,
  };
}

function result(pass, score, reason) {
  return { pass: Boolean(pass), score: pass ? score : 0, reason };
}

function assertSchemaCompliance(output, context) {
  const { data, error } = parseModelOutput(output);
  if (error) return result(false, 0, error);
  const errors = validateRequirements(data);
  if (errors.length > 0) {
    return result(false, 0, `Schema validation failed: ${errors.join('; ')}`);
  }
  return result(true, 1, 'Output conforms to requirements.json schema');
}

function assertFieldCompleteness(output, context) {
  const { data, error } = parseModelOutput(output);
  if (error) return result(false, 0, error);

  const truth = getGroundTruth(context);
  if (!truth.expectedTable) {
    return result(false, 0, 'Fixture missing vars.expected_table');
  }
  if (!truth.expectedTriggerType) {
    return result(false, 0, 'Fixture missing vars.expected_trigger_type');
  }

  if (String(data.table) !== String(truth.expectedTable)) {
    return result(false, 0, `Expected table=${truth.expectedTable}, got ${data.table}`);
  }
  if (String(data.trigger_type) !== String(truth.expectedTriggerType)) {
    return result(
      false,
      0,
      `Expected trigger_type=${truth.expectedTriggerType}, got ${data.trigger_type}`
    );
  }
  if (!TRIGGER_TYPES.includes(data.trigger_type)) {
    return result(false, 0, `Invalid trigger_type enum: ${data.trigger_type}`);
  }

  if (truth.expectSchema && truth.expectedSchema) {
    if (String(data.schema) !== String(truth.expectedSchema)) {
      return result(false, 0, `Expected schema=${truth.expectedSchema}, got ${data.schema}`);
    }
  }

  if (truth.expectedConstraints) {
    const expected = Array.isArray(truth.expectedConstraints)
      ? truth.expectedConstraints.map(String)
      : JSON.parse(String(truth.expectedConstraints));
    const actual = Array.isArray(data.constraints) ? data.constraints.map(String) : [];
    for (const item of expected) {
      if (!actual.includes(item)) {
        return result(false, 0, `Missing expected constraint: ${item}`);
      }
    }
  }

  return result(true, 1, 'Required fields match fixture ground truth');
}

function assertPkExtraction(output, context) {
  const { data, error } = parseModelOutput(output);
  if (error) return result(false, 0, error);

  const truth = getGroundTruth(context);
  if (truth.expectedPk == null) {
    return result(false, 0, 'Fixture missing vars.expected_pk');
  }

  const expectedPk = Array.isArray(truth.expectedPk)
    ? truth.expectedPk.map(String)
    : typeof truth.expectedPk === 'string' && truth.expectedPk.startsWith('[')
      ? JSON.parse(truth.expectedPk).map(String)
      : normalizePk(truth.expectedPk);

  const actualPk = normalizePk(data.pk);
  const expectComposite = expectedPk.length > 1;

  if (expectComposite && !Array.isArray(data.pk)) {
    return result(false, 0, `Composite PK expected array, got ${typeof data.pk}`);
  }
  if (!expectComposite && Array.isArray(data.pk) && data.pk.length === 1) {
    // single-element array acceptable if values match
  } else if (!expectComposite && Array.isArray(data.pk) && data.pk.length > 1) {
    return result(false, 0, `Single PK expected string, got array ${JSON.stringify(data.pk)}`);
  }

  if (actualPk.length !== expectedPk.length) {
    return result(
      false,
      0,
      `PK length mismatch: expected ${expectedPk.length}, got ${actualPk.length}`
    );
  }

  for (let i = 0; i < expectedPk.length; i += 1) {
    if (actualPk[i] !== expectedPk[i]) {
      return result(
        false,
        0,
        `PK[${i}] mismatch: expected ${expectedPk[i]}, got ${actualPk[i]}`
      );
    }
  }

  return result(true, 1, `PK extracted correctly (${actualPk.join(', ')})`);
}

module.exports = {
  parseModelOutput,
  validateRequirements,
  assertSchemaCompliance,
  assertFieldCompleteness,
  assertPkExtraction,
  TRIGGER_TYPES,
};

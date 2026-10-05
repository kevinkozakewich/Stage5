/**
 * Builds deterministic golden requirements.json from fixture vars.
 */

function asStringArray(value) {
  if (!value) return undefined;
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch (_) {
      /* scalar string */
    }
    return [value];
  }
  return [String(value)];
}

function buildGoldenOutput(vars) {
  const pk = vars.expected_pk;
  let pkValue = pk;
  if (typeof pk === 'string' && pk.startsWith('[')) {
    pkValue = JSON.parse(pk);
  } else if (Array.isArray(pk)) {
    pkValue = pk.length === 1 && vars.expect_pk_scalar ? pk[0] : pk;
  }

  const payload = {
    table: vars.expected_table,
    pk: pkValue,
    trigger_type: vars.expected_trigger_type,
  };

  if (vars.expected_schema) {
    payload.schema = vars.expected_schema;
  }

  const constraints = asStringArray(vars.expected_constraints);
  if (constraints && constraints.length > 0) {
    payload.constraints = constraints;
  }

  return JSON.stringify(payload, null, 2);
}

module.exports = { buildGoldenOutput };

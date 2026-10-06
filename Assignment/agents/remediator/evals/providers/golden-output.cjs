/**
 * Returns golden remediated trigger.sql from fixture vars.
 */

function buildGoldenOutput(vars) {
  if (vars.golden_remediated_sql) {
    return String(vars.golden_remediated_sql).trim();
  }
  throw new Error('Fixture missing vars.golden_remediated_sql');
}

module.exports = { buildGoldenOutput };

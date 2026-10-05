/**
 * Promptfoo custom provider: returns golden trigger.sql (no API key).
 */

const { buildGoldenOutput } = require('./golden-output.cjs');

module.exports = class GoldenProvider {
  constructor(options = {}) {
    this.providerId = options.id || 'golden';
    this.label = options.label || 'Golden Output (offline)';
  }

  id() {
    return this.providerId;
  }

  async callApi(_prompt, context) {
    const vars = context?.vars || context?.test?.vars || {};
    return {
      output: buildGoldenOutput(vars),
    };
  }
};

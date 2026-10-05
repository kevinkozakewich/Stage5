/**
 * Promptfoo custom provider: returns golden JSON from fixture vars (no API key).
 * Used for offline CI / examiner verification via promptfooconfig.golden.yaml.
 */

const { buildGoldenOutput } = require('./golden-output');

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

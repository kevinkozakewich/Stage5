import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, '..', '..', 'coordinator', 'tools', 'schema.json');

const FORBIDDEN_TOOL_PATTERNS = [
  /^read_file$/i,
  /^write_file$/i,
  /^bash$/i,
  /^shell$/i,
  /^http_/i,
  /^run_guardrail/i,
  /^validate_/i,
];

/**
 * @returns {{ pass: boolean, tools: string[], findings: string[] }}
 */
export function validateDispatchOnlySchema() {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  const tools = (schema.tools ?? []).map((t) => t.name);
  const findings = [];

  for (const name of tools) {
    if (!/^launch_[a-z_]+$/.test(name)) {
      findings.push(`tool ${name} must match launch_* pattern`);
    }
    for (const forbidden of FORBIDDEN_TOOL_PATTERNS) {
      if (forbidden.test(name)) {
        findings.push(`forbidden tool on coordinator: ${name}`);
      }
    }
  }

  if (tools.length === 0) {
    findings.push('coordinator must declare at least one launch_* tool');
  }

  return { pass: findings.length === 0, tools, findings };
}

export const DISPATCH_TOOL_NAMES = [
  'launch_spec_parser',
  'launch_trigger_codegen',
  'launch_trigger_review',
  'launch_remediator',
  'launch_adversarial_reviewer',
  'launch_delivery_report_writer',
];

#!/usr/bin/env node
// G1 JSON schema check on requirements.json after S1

import path from 'path';
import { fileURLToPath } from 'url';
import schema from './lib/requirements-schema.json' with { type: 'json' };
import { readJsonFile, exitWithResult } from './lib/cli.js';

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

export function validateRequirements(data) {
  const errors = [];
  validateObject(data, schema, 'requirements', errors);

  return {
    guardrail: 'G1',
    pass: errors.length === 0,
    findings: errors,
    data: errors.length === 0 ? data : undefined,
  };
}

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node validate-requirements-schema.js <requirements.json>');
    process.exit(2);
  }

  let data;
  try {
    data = readJsonFile(filePath);
  } catch (err) {
    exitWithResult({
      guardrail: 'G1',
      pass: false,
      findings: [err.message],
      file: path.resolve(filePath),
    });
    return;
  }

  exitWithResult({
    ...validateRequirements(data),
    file: path.resolve(filePath),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

export { schema };

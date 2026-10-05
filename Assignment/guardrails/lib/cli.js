import fs from 'fs';
import path from 'path';

export function readTextFile(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  return fs.readFileSync(resolved, 'utf8');
}

export function readJsonFile(filePath) {
  const text = readTextFile(filePath);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid JSON in ${path.resolve(filePath)}: ${err.message}`);
  }
}

export function emitResult(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function exitWithResult(result) {
  emitResult(result);
  process.exit(result.pass ? 0 : 1);
}

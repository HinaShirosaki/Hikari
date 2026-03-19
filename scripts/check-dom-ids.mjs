#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const HTML_PATH = path.join(ROOT_DIR, 'index.html');
const JS_SCAN_ROOTS = [
  path.join(ROOT_DIR, 'src', 'renderer', 'modules'),
  path.join(ROOT_DIR, 'src', 'renderer', 'renderer.js')
];
const ALLOWED_MISSING_IDS = new Set([
  'exit-btn'
]);
const ALLOWED_MISSING_ID_PATTERNS = [
  /^sample-loc-/
];

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectJsFiles(targetPath) {
  const stats = await fs.stat(targetPath);
  if (stats.isFile()) {
    return targetPath.endsWith('.js') ? [targetPath] : [];
  }

  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectJsFiles(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(entryPath);
    }
  }
  return files;
}

function collectHtmlIds(htmlText) {
  const ids = new Set();
  const idRegex = /\bid="([^"]+)"/g;
  let match = idRegex.exec(htmlText);
  while (match) {
    ids.add(match[1]);
    match = idRegex.exec(htmlText);
  }
  return ids;
}

function lineNumberForIndex(source, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10) {
      line += 1;
    }
  }
  return line;
}

function collectDocumentGetElementByIdCalls(jsText) {
  // Only track direct global-document calls; this avoids iframe/local document false positives.
  const regex = /(?<![\w$.])document\.getElementById\(\s*['"]([^'"]+)['"]\s*\)/g;
  const matches = [];
  let match = regex.exec(jsText);
  while (match) {
    matches.push({ id: match[1], index: match.index });
    match = regex.exec(jsText);
  }
  return matches;
}

function isAllowedMissingId(id) {
  if (ALLOWED_MISSING_IDS.has(id)) {
    return true;
  }
  return ALLOWED_MISSING_ID_PATTERNS.some((pattern) => pattern.test(id));
}

async function main() {
  if (!await fileExists(HTML_PATH)) {
    throw new Error('index.html was not found. Run the UI build first.');
  }

  const htmlText = await fs.readFile(HTML_PATH, 'utf8');
  const htmlIds = collectHtmlIds(htmlText);
  const missing = new Map();

  for (const scanRoot of JS_SCAN_ROOTS) {
    if (!await fileExists(scanRoot)) {
      continue;
    }
    const files = await collectJsFiles(scanRoot);
    for (const filePath of files) {
      const jsText = await fs.readFile(filePath, 'utf8');
      const calls = collectDocumentGetElementByIdCalls(jsText);
      for (const call of calls) {
        if (htmlIds.has(call.id)) {
          continue;
        }
        if (isAllowedMissingId(call.id)) {
          continue;
        }
        const rel = path.relative(ROOT_DIR, filePath).split(path.sep).join('/');
        const line = lineNumberForIndex(jsText, call.index);
        const key = call.id;
        if (!missing.has(key)) {
          missing.set(key, []);
        }
        missing.get(key).push(`${rel}:${line}`);
      }
    }
  }

  if (!missing.size) {
    console.log('DOM ID check passed: all document.getElementById() IDs exist in index.html.');
    return;
  }

  console.error('DOM ID check failed. Missing IDs in generated index.html:');
  for (const [id, refs] of [...missing.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.error(`- ${id}`);
    for (const ref of refs) {
      console.error(`  - ${ref}`);
    }
  }
  process.exit(1);
}

main().catch((error) => {
  console.error('[check-dom-ids] Failed:', error?.message || error);
  process.exit(1);
});

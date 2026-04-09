'use strict';

const fs = require('fs');
const path = require('path');

const SQLJS_RELATIVE_PATH = path.join('vendor', 'sqljs', 'sql-wasm.js');

function pushCandidate(candidates, candidatePath) {
  const normalized = String(candidatePath || '').trim();
  if (!normalized || candidates.includes(normalized)) {
    return;
  }
  candidates.push(normalized);
}

function buildSearchRoots(startDir) {
  const roots = [];
  let current = path.resolve(startDir || __dirname);

  for (let depth = 0; depth < 8; depth += 1) {
    pushCandidate(roots, current);
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  if (process.resourcesPath) {
    pushCandidate(roots, process.resourcesPath);
    pushCandidate(roots, path.join(process.resourcesPath, 'app.asar'));
  }

  if (require.main?.filename) {
    let mainDir = path.dirname(require.main.filename);
    for (let depth = 0; depth < 6; depth += 1) {
      pushCandidate(roots, mainDir);
      const parent = path.dirname(mainDir);
      if (parent === mainDir) {
        break;
      }
      mainDir = parent;
    }
  }

  return roots;
}

function resolveSqlJsWasmJsPath(startDir = __dirname) {
  try {
    return require.resolve('sql.js/dist/sql-wasm.js');
  } catch {
    const candidates = [];
    buildSearchRoots(startDir).forEach((rootDir) => {
      pushCandidate(candidates, path.join(rootDir, SQLJS_RELATIVE_PATH));
      pushCandidate(candidates, path.join(rootDir, 'src', SQLJS_RELATIVE_PATH));
    });

    const resolved = candidates.find((candidatePath) => fs.existsSync(candidatePath));
    if (resolved) {
      return resolved;
    }

    throw new Error(`Unable to locate sql-wasm.js. Checked: ${candidates.join(', ')}`);
  }
}

module.exports = {
  resolveSqlJsWasmJsPath
};

import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from './paths.mjs';

function dedupeRecords(records, keyBuilder) {
  const seen = new Set();
  const results = [];

  for (const record of records) {
    const key = keyBuilder(record);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(record);
  }

  return results;
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function toRepoRelativePath(filePath) {
  return toPosixPath(path.relative(repoRoot, filePath));
}

function countCharacters(value, target) {
  let count = 0;
  for (const char of value) {
    if (char === target) {
      count += 1;
    }
  }
  return count;
}

function resolveLocalSpecifier(fromFilePath, specifier) {
  const absoluteBase = path.resolve(path.dirname(fromFilePath), specifier);
  const hasExtension = path.extname(absoluteBase) !== '';
  const candidates = hasExtension
    ? [absoluteBase]
    : [
        absoluteBase,
        `${absoluteBase}.js`,
        `${absoluteBase}.mjs`,
        path.join(absoluteBase, 'index.js'),
        path.join(absoluteBase, 'index.mjs')
      ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.normalize(candidate);
    }
  }

  return path.normalize(hasExtension ? absoluteBase : `${absoluteBase}.js`);
}

function walkFiles(directoryPath) {
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(absolutePath));
      continue;
    }
    if (entry.isFile() && absolutePath.endsWith('.js')) {
      results.push(absolutePath);
    }
  }

  return results.sort((left, right) => left.localeCompare(right));
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function extractLocalImports(filePath, source) {
  const specifiers = [];
  const patterns = [
    /(?:^|\n)\s*import\s+[^;]*?\s+from\s+['"](\.{1,2}\/[^'"]+)['"]\s*;?/g,
    /(?:^|\n)\s*import\s+['"](\.{1,2}\/[^'"]+)['"]\s*;?/g,
    /(?:^|\n)\s*export\s+[^;]*?\s+from\s+['"](\.{1,2}\/[^'"]+)['"]\s*;?/g,
    /(?:^|\n)\s*(?:const|let|var)\s+[^=]+=\s*require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)\s*;?/g,
    /(?:^|\n)\s*require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)\s*;?/g
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(source);
    while (match) {
      specifiers.push(resolveLocalSpecifier(filePath, match[1]));
      match = pattern.exec(source);
    }
  }

  return uniqueSorted(specifiers);
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lineNumberAt(source, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source[cursor] === '\n') {
      line += 1;
    }
  }
  return line;
}

function extractImportBindings(filePath, source) {
  const bindings = [];

  const namespacePattern = /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"](\.{1,2}\/[^'"]+)['"]\s*;?/g;
  let namespaceMatch = namespacePattern.exec(source);
  while (namespaceMatch) {
    bindings.push({
      kind: 'namespace',
      localName: namespaceMatch[1],
      importedName: '*',
      sourceFile: resolveLocalSpecifier(filePath, namespaceMatch[2])
    });
    namespaceMatch = namespacePattern.exec(source);
  }

  const defaultAndNamedPattern = /import\s+([A-Za-z_$][\w$]*)\s*,\s*\{\s*([^}]+)\s*\}\s*from\s+['"](\.{1,2}\/[^'"]+)['"]\s*;?/g;
  let defaultAndNamedMatch = defaultAndNamedPattern.exec(source);
  while (defaultAndNamedMatch) {
    const sourceFile = resolveLocalSpecifier(filePath, defaultAndNamedMatch[3]);
    bindings.push({
      kind: 'default',
      localName: defaultAndNamedMatch[1],
      importedName: 'default',
      sourceFile
    });
    defaultAndNamedMatch[2]
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((specifier) => {
        const specifierMatch = specifier.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
        if (!specifierMatch) {
          return;
        }
        bindings.push({
          kind: 'named',
          localName: specifierMatch[2] || specifierMatch[1],
          importedName: specifierMatch[1],
          sourceFile
        });
      });
    defaultAndNamedMatch = defaultAndNamedPattern.exec(source);
  }

  const namedPattern = /import\s*\{\s*([^}]+)\s*\}\s*from\s+['"](\.{1,2}\/[^'"]+)['"]\s*;?/g;
  let namedMatch = namedPattern.exec(source);
  while (namedMatch) {
    const sourceFile = resolveLocalSpecifier(filePath, namedMatch[2]);
    namedMatch[1]
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((specifier) => {
        const specifierMatch = specifier.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
        if (!specifierMatch) {
          return;
        }
        bindings.push({
          kind: 'named',
          localName: specifierMatch[2] || specifierMatch[1],
          importedName: specifierMatch[1],
          sourceFile
        });
      });
    namedMatch = namedPattern.exec(source);
  }

  const defaultOnlyPattern = /import\s+([A-Za-z_$][\w$]*)\s+from\s+['"](\.{1,2}\/[^'"]+)['"]\s*;?/g;
  let defaultOnlyMatch = defaultOnlyPattern.exec(source);
  while (defaultOnlyMatch) {
    bindings.push({
      kind: 'default',
      localName: defaultOnlyMatch[1],
      importedName: 'default',
      sourceFile: resolveLocalSpecifier(filePath, defaultOnlyMatch[2])
    });
    defaultOnlyMatch = defaultOnlyPattern.exec(source);
  }

  const destructuredRequirePattern = /(?:const|let|var)\s*\{\s*([^}]+)\s*\}\s*=\s*require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)\s*;?/g;
  let destructuredRequireMatch = destructuredRequirePattern.exec(source);
  while (destructuredRequireMatch) {
    const sourceFile = resolveLocalSpecifier(filePath, destructuredRequireMatch[2]);
    destructuredRequireMatch[1]
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((specifier) => {
        const specifierMatch = specifier.match(/^([A-Za-z_$][\w$]*)(?:\s*:\s*([A-Za-z_$][\w$]*))?$/);
        if (!specifierMatch) {
          return;
        }
        bindings.push({
          kind: 'named',
          localName: specifierMatch[2] || specifierMatch[1],
          importedName: specifierMatch[1],
          sourceFile
        });
      });
    destructuredRequireMatch = destructuredRequirePattern.exec(source);
  }

  const requirePattern = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)\s*;?/g;
  let requireMatch = requirePattern.exec(source);
  while (requireMatch) {
    bindings.push({
      kind: 'require',
      localName: requireMatch[1],
      importedName: 'module',
      sourceFile: resolveLocalSpecifier(filePath, requireMatch[2])
    });
    requireMatch = requirePattern.exec(source);
  }

  return dedupeRecords(
    bindings,
    (binding) => `${binding.kind}:${binding.localName}:${binding.importedName}:${binding.sourceFile}`
  );
}

export {
  dedupeRecords,
  countCharacters,
  escapeRegExp,
  extractImportBindings,
  extractLocalImports,
  lineNumberAt,
  resolveLocalSpecifier,
  toRepoRelativePath,
  uniqueSorted,
  walkFiles
};

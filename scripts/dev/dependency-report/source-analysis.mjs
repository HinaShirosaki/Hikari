import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const espree = require('espree');
const CODE_FILE_PATTERN = /\.(?:c?js|mjs)$/;

function parseSource(source, filePath) {
  const options = {
    ecmaVersion: 'latest',
    range: true,
    loc: true,
    comment: true,
    ecmaFeatures: { globalReturn: true }
  };
  try {
    return { ast: espree.parse(source, { ...options, sourceType: 'module' }), sourceType: 'module', error: null };
  } catch (moduleError) {
    try {
      return { ast: espree.parse(source, { ...options, sourceType: 'script' }), sourceType: 'script', error: null };
    } catch (scriptError) {
      return {
        ast: null,
        sourceType: 'unknown',
        error: `${filePath}: ${scriptError.message || moduleError.message}`
      };
    }
  }
}

function isNode(value) {
  return Boolean(value && typeof value === 'object' && typeof value.type === 'string');
}

function walk(node, visitor, ancestors = []) {
  if (!isNode(node)) {
    return;
  }
  visitor(node, ancestors);
  const nextAncestors = [...ancestors, node];
  Object.entries(node).forEach(([key, value]) => {
    if (key === 'parent' || key === 'comments' || key === 'tokens') {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => walk(entry, visitor, nextAncestors));
    } else if (isNode(value)) {
      walk(value, visitor, nextAncestors);
    }
  });
}

function propertyName(node) {
  if (!node) return '';
  if (node.type === 'Identifier' || node.type === 'PrivateIdentifier') return node.name;
  if (node.type === 'Literal') return String(node.value ?? '');
  return '';
}

function patternNames(node) {
  if (!node) return [];
  if (node.type === 'Identifier') return [node.name];
  if (node.type === 'RestElement') return patternNames(node.argument);
  if (node.type === 'AssignmentPattern') return patternNames(node.left);
  if (node.type === 'ArrayPattern') return node.elements.flatMap(patternNames);
  if (node.type === 'ObjectPattern') {
    return node.properties.flatMap((property) => (
      property.type === 'RestElement' ? patternNames(property.argument) : patternNames(property.value)
    ));
  }
  return [];
}

function literalString(node) {
  return node?.type === 'Literal' && typeof node.value === 'string' ? node.value : '';
}

function memberPath(node) {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type !== 'MemberExpression') return '';
  const object = memberPath(node.object);
  const property = node.computed ? propertyName(node.property) : memberPath(node.property);
  return object && property ? `${object}.${property}` : '';
}

function normalizeFunctionSource(value) {
  return String(value || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n\r]*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function functionFingerprint(source, node) {
  const normalized = normalizeFunctionSource(source.slice(node.range[0], node.range[1]));
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 20);
}

function enclosingFunctionName(ancestors) {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const node = ancestors[index];
    if (node.type === 'FunctionDeclaration' && node.id?.name) return node.id.name;
    if ((node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression')) {
      const parent = ancestors[index - 1];
      if (parent?.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') return parent.id.name;
    }
  }
  return '';
}

function addDirectExport(analysis, exportedName, localName, line, kind = 'direct') {
  if (!exportedName) return;
  analysis.directExports.add(exportedName);
  analysis.exportRecords.push({ exportedName, localName: localName || exportedName, line, kind });
}

function addImportEdge(analysis, edge) {
  const key = [edge.kind, edge.specifier, edge.line, JSON.stringify(edge.bindings || [])].join(':');
  if (analysis.importEdgeKeys.has(key)) return;
  analysis.importEdgeKeys.add(key);
  analysis.imports.push(edge);
}

function analyzeSource(filePath, source) {
  const parsed = parseSource(source, filePath);
  const analysis = {
    filePath,
    sourceType: parsed.sourceType,
    parseError: parsed.error,
    directExports: new Set(),
    effectiveExports: new Set(),
    exportRecords: [],
    reexports: [],
    imports: [],
    importEdgeKeys: new Set(),
    functions: [],
    hasUnknownCjsExports: false
  };
  if (!parsed.ast) return analysis;

  parsed.ast.body.forEach((statement) => {
    if (statement.type === 'ImportDeclaration') {
      addImportEdge(analysis, {
        kind: 'import',
        specifier: literalString(statement.source),
        line: statement.loc.start.line,
        bindings: statement.specifiers.map((specifier) => {
          if (specifier.type === 'ImportDefaultSpecifier') {
            return { importedName: 'default', localName: specifier.local.name, kind: 'default' };
          }
          if (specifier.type === 'ImportNamespaceSpecifier') {
            return { importedName: '*', localName: specifier.local.name, kind: 'namespace' };
          }
          return {
            importedName: propertyName(specifier.imported),
            localName: specifier.local.name,
            kind: 'named'
          };
        })
      });
      return;
    }
    if (statement.type === 'ExportDefaultDeclaration') {
      const localName = statement.declaration?.id?.name || 'default';
      addDirectExport(analysis, 'default', localName, statement.loc.start.line, 'default');
      return;
    }
    if (statement.type === 'ExportNamedDeclaration') {
      if (statement.declaration) {
        if (statement.declaration.id?.name) {
          addDirectExport(
            analysis,
            statement.declaration.id.name,
            statement.declaration.id.name,
            statement.loc.start.line
          );
        } else if (statement.declaration.type === 'VariableDeclaration') {
          statement.declaration.declarations.flatMap((declaration) => patternNames(declaration.id)).forEach((name) => {
            addDirectExport(analysis, name, name, statement.loc.start.line);
          });
        }
      }
      if (statement.source) {
        const specifier = literalString(statement.source);
        addImportEdge(analysis, {
          kind: 'reexport',
          specifier,
          line: statement.loc.start.line,
          bindings: statement.specifiers.map((entry) => ({
            importedName: propertyName(entry.local),
            localName: propertyName(entry.exported),
            kind: 'reexport'
          }))
        });
        statement.specifiers.forEach((entry) => {
          analysis.reexports.push({
            specifier,
            importedName: propertyName(entry.local),
            exportedName: propertyName(entry.exported),
            line: statement.loc.start.line,
            exportAll: false
          });
        });
      } else {
        statement.specifiers.forEach((entry) => {
          addDirectExport(
            analysis,
            propertyName(entry.exported),
            propertyName(entry.local),
            statement.loc.start.line,
            'list'
          );
        });
      }
      return;
    }
    if (statement.type === 'ExportAllDeclaration') {
      const specifier = literalString(statement.source);
      addImportEdge(analysis, {
        kind: 'reexport-all',
        specifier,
        line: statement.loc.start.line,
        bindings: [{ importedName: '*', localName: '*', kind: 'reexport-all' }]
      });
      analysis.reexports.push({
        specifier,
        importedName: '*',
        exportedName: '*',
        line: statement.loc.start.line,
        exportAll: true
      });
    }
  });

  const handledRequireRanges = new Set();
  walk(parsed.ast, (node, ancestors) => {
    if (node.type === 'FunctionDeclaration' && node.id?.name) {
      analysis.functions.push({
        name: node.id.name,
        line: node.loc.start.line,
        scope: enclosingFunctionName(ancestors),
        fingerprint: functionFingerprint(source, node),
        async: Boolean(node.async)
      });
    } else if (node.type === 'VariableDeclarator'
      && node.id?.type === 'Identifier'
      && (node.init?.type === 'FunctionExpression' || node.init?.type === 'ArrowFunctionExpression')) {
      analysis.functions.push({
        name: node.id.name,
        line: node.loc.start.line,
        scope: enclosingFunctionName(ancestors),
        fingerprint: functionFingerprint(source, node.init),
        async: Boolean(node.init.async)
      });
    } else if (node.type === 'Property'
      && !node.computed
      && (node.value?.type === 'FunctionExpression' || node.value?.type === 'ArrowFunctionExpression')) {
      const name = propertyName(node.key);
      if (name) {
        analysis.functions.push({
          name,
          line: node.loc.start.line,
          scope: enclosingFunctionName(ancestors),
          fingerprint: functionFingerprint(source, node.value),
          async: Boolean(node.value.async)
        });
      }
    }

    if (node.type === 'VariableDeclarator'
      && node.init?.type === 'CallExpression'
      && node.init.callee?.type === 'Identifier'
      && node.init.callee.name === 'require') {
      const specifier = literalString(node.init.arguments[0]);
      if (!specifier) return;
      handledRequireRanges.add(node.init.range.join(':'));
      let bindings = [];
      if (node.id.type === 'Identifier') {
        bindings = [{ importedName: 'module', localName: node.id.name, kind: 'require' }];
      } else if (node.id.type === 'ObjectPattern') {
        bindings = node.id.properties
          .filter((property) => property.type === 'Property')
          .map((property) => ({
            importedName: propertyName(property.key),
            localName: patternNames(property.value)[0] || propertyName(property.key),
            kind: 'named-require'
          }));
      }
      addImportEdge(analysis, { kind: 'require', specifier, line: node.loc.start.line, bindings });
    }

    if (node.type === 'CallExpression'
      && node.callee?.type === 'Identifier'
      && node.callee.name === 'require'
      && !handledRequireRanges.has(node.range.join(':'))) {
      const specifier = literalString(node.arguments[0]);
      if (specifier) {
        addImportEdge(analysis, { kind: 'require-side-effect', specifier, line: node.loc.start.line, bindings: [] });
      }
    }
    if (node.type === 'ImportExpression') {
      const specifier = literalString(node.source);
      if (specifier) {
        addImportEdge(analysis, { kind: 'dynamic-import', specifier, line: node.loc.start.line, bindings: [] });
      }
    }

    if (node.type === 'AssignmentExpression' && node.operator === '=') {
      const target = memberPath(node.left);
      if (target === 'module.exports') {
        if (node.right.type === 'ObjectExpression') {
          node.right.properties.forEach((property) => {
            if (property.type !== 'Property' || property.computed) return;
            const exportedName = propertyName(property.key);
            const localName = property.value?.type === 'Identifier' ? property.value.name : exportedName;
            addDirectExport(analysis, exportedName, localName, node.loc.start.line, 'commonjs');
          });
        } else {
          analysis.hasUnknownCjsExports = true;
          addDirectExport(
            analysis,
            'default',
            node.right?.type === 'Identifier' ? node.right.name : 'default',
            node.loc.start.line,
            'commonjs-default'
          );
        }
      } else if (target.startsWith('module.exports.') || target.startsWith('exports.')) {
        const exportedName = target.split('.').at(-1);
        const localName = node.right?.type === 'Identifier' ? node.right.name : exportedName;
        addDirectExport(analysis, exportedName, localName, node.loc.start.line, 'commonjs-property');
      }
    }
  });

  analysis.effectiveExports = new Set(analysis.directExports);
  delete analysis.importEdgeKeys;
  return analysis;
}

function resolveLocalSpecifier(fromFilePath, specifier, filePaths) {
  if (!String(specifier || '').startsWith('.')) return '';
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFilePath), specifier));
  const hasExtension = Boolean(path.posix.extname(base));
  const candidates = hasExtension
    ? [base]
    : [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}.json`, `${base}/index.js`, `${base}/index.mjs`, `${base}/index.cjs`];
  return candidates.find((candidate) => filePaths.has(candidate)) || '';
}

function analyzeSnapshot(files) {
  const analyses = new Map();
  const filePaths = new Set(files.keys());
  files.forEach((source, filePath) => {
    if (filePath.startsWith('src/') && CODE_FILE_PATTERN.test(filePath)) {
      analyses.set(filePath, analyzeSource(filePath, source));
    }
  });
  analyses.forEach((analysis) => {
    analysis.imports.forEach((edge) => {
      edge.target = resolveLocalSpecifier(analysis.filePath, edge.specifier, filePaths);
    });
    analysis.reexports.forEach((edge) => {
      edge.target = resolveLocalSpecifier(analysis.filePath, edge.specifier, filePaths);
    });
  });

  let changed = true;
  let passes = 0;
  while (changed && passes < analyses.size + 1) {
    changed = false;
    passes += 1;
    analyses.forEach((analysis) => {
      analysis.reexports.forEach((edge) => {
        const target = analyses.get(edge.target);
        if (!target) return;
        if (edge.exportAll) {
          target.effectiveExports.forEach((name) => {
            if (name !== 'default' && !analysis.effectiveExports.has(name)) {
              analysis.effectiveExports.add(name);
              changed = true;
            }
          });
        } else if (target.effectiveExports.has(edge.importedName)
          && !analysis.effectiveExports.has(edge.exportedName)) {
          analysis.effectiveExports.add(edge.exportedName);
          changed = true;
        }
      });
    });
  }
  return analyses;
}

function validateImports(analyses) {
  const issues = [];
  analyses.forEach((analysis) => {
    if (analysis.parseError) {
      issues.push({ type: 'parse-error', filePath: analysis.filePath, line: 1, message: analysis.parseError });
    }
    analysis.imports.forEach((edge) => {
      if (!edge.specifier.startsWith('.')) return;
      if (!edge.target) {
        issues.push({
          type: 'missing-target',
          filePath: analysis.filePath,
          line: edge.line,
          specifier: edge.specifier,
          message: `${analysis.filePath}:${edge.line} cannot resolve ${edge.specifier}`
        });
        return;
      }
      const target = analyses.get(edge.target);
      if (!target) return;
      edge.bindings.forEach((binding) => {
        if (binding.importedName === '*' || binding.importedName === 'module') return;
        if (!target.effectiveExports.has(binding.importedName) && !target.hasUnknownCjsExports) {
          issues.push({
            type: edge.kind.startsWith('reexport') ? 'missing-reexport' : 'missing-export',
            filePath: analysis.filePath,
            line: edge.line,
            target: edge.target,
            importedName: binding.importedName,
            message: `${analysis.filePath}:${edge.line} imports ${binding.importedName} from ${edge.target}, which does not export it`
          });
        }
      });
    });
  });
  return issues;
}

export {
  CODE_FILE_PATTERN,
  analyzeSnapshot,
  validateImports
};

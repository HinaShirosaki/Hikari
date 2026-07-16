import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const srcRoot = path.join(repoRoot, 'src');
const rendererRoot = path.join(repoRoot, 'src', 'renderer');
const rendererModulesRoot = path.join(rendererRoot, 'modules');
const rendererManifestsRoot = path.join(rendererRoot, 'module-manifests');
const rendererServicesRoot = path.join(rendererRoot, 'services');
const moduleRuntimeFile = path.join(rendererRoot, 'core', 'module-runtime.js');
const defaultOutputPath = path.join(repoRoot, 'reports', 'renderer-module-relationships.md');

function parseArguments(argv) {
  let outputPath = defaultOutputPath;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      printHelp();
      process.exit(0);
    }

    if (token === '--output' && argv[index + 1]) {
      outputPath = path.resolve(process.cwd(), argv[index + 1]);
      index += 1;
      continue;
    }

    if (token.startsWith('--output=')) {
      outputPath = path.resolve(process.cwd(), token.slice('--output='.length));
    }
  }

  return { outputPath };
}

function printHelp() {
  console.log('Usage: node scripts/report-module-relationships.mjs [--output <path>]');
  console.log('');
  console.log('Scans src/**/*.js for local import dependencies and direct imported API calls.');
  console.log('Also infers renderer service and registry-based communication from');
  console.log('src/renderer/core/module-runtime.js (init/registration root) and src/renderer/services/.');
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

function hasDirectory(directoryPath) {
  return fs.existsSync(directoryPath) && fs.statSync(directoryPath).isDirectory();
}

function getRendererModuleFamily(filePath) {
  const relativePath = path.relative(rendererModulesRoot, filePath);
  const parts = relativePath.split(path.sep).filter(Boolean);
  if (parts.length > 1) {
    return parts[0];
  }

  const baseName = path.basename(relativePath, '.js');
  if (hasDirectory(path.join(rendererModulesRoot, baseName))) {
    return baseName;
  }

  const segments = baseName.split('-');
  for (let count = segments.length - 1; count >= 1; count -= 1) {
    const candidate = segments.slice(0, count).join('-');
    if (hasDirectory(path.join(rendererModulesRoot, candidate))) {
      return candidate;
    }
  }

  return baseName;
}

function describeSourceArea(filePath) {
  const relativePath = toRepoRelativePath(filePath);

  if (relativePath === 'src/renderer/renderer.js') {
    return {
      area: 'renderer-bootstrap',
      family: 'renderer'
    };
  }

  if (relativePath.startsWith('src/renderer/modules/')) {
    return {
      area: 'renderer-module',
      family: getRendererModuleFamily(filePath)
    };
  }

  if (relativePath.startsWith('src/renderer/services/')) {
    return {
      area: 'renderer-service',
      family: path.basename(relativePath, '.js')
    };
  }

  if (relativePath.startsWith('src/main/agent/')) {
    return {
      area: 'main-agent',
      family: 'agent'
    };
  }

  if (relativePath.startsWith('src/main/lib/')) {
    return {
      area: 'main-lib',
      family: 'lib'
    };
  }

  if (relativePath.startsWith('src/main/storage/')) {
    return {
      area: 'main-storage',
      family: 'storage'
    };
  }

  if (relativePath.startsWith('src/main/data/')) {
    return {
      area: 'main-data',
      family: 'data'
    };
  }

  if (relativePath.startsWith('src/main/')) {
    return {
      area: 'main',
      family: 'main'
    };
  }

  return {
    area: 'src',
    family: path.dirname(relativePath)
  };
}

function isTopLevelRendererModuleFile(filePath) {
  const relativePath = path.relative(rendererModulesRoot, filePath);
  return !relativePath.includes(path.sep);
}

function classifyDirectApiRelation(callerFile, calleeFile) {
  const caller = describeSourceArea(callerFile);
  const callee = describeSourceArea(calleeFile);

  if (caller.area === 'renderer-module' && callee.area === 'renderer-module' && caller.family === callee.family) {
    if (isTopLevelRendererModuleFile(callerFile) && !isTopLevelRendererModuleFile(calleeFile)) {
      return 'renderer composition/internal';
    }
    return 'same renderer module family';
  }

  if (caller.area === callee.area && caller.family === callee.family) {
    return `same ${caller.family} family`;
  }

  if (caller.area === callee.area) {
    return `same ${caller.area}`;
  }

  return `${caller.area} -> ${callee.area}`;
}

function extractDirectImportedApiCalls(filePath, source) {
  const importBindings = extractImportBindings(filePath, source)
    .filter((binding) => binding.sourceFile.startsWith(srcRoot));
  const calls = [];

  for (const binding of importBindings) {
    if (binding.kind === 'namespace' || binding.kind === 'require') {
      const pattern = new RegExp(`\\b${escapeRegExp(binding.localName)}\\.([A-Za-z_$][\\w$]*)\\s*\\(`, 'g');
      let match = pattern.exec(source);
      while (match) {
        calls.push({
          callerFile: filePath,
          calleeFile: binding.sourceFile,
          importKind: binding.kind,
          importedAs: binding.localName,
          importedName: match[1],
          callExpression: `${binding.localName}.${match[1]}()`,
          line: lineNumberAt(source, match.index),
          relation: classifyDirectApiRelation(filePath, binding.sourceFile)
        });
        match = pattern.exec(source);
      }

      if (binding.kind === 'require') {
        const directRequirePattern = new RegExp(`\\b${escapeRegExp(binding.localName)}\\s*\\(`, 'g');
        let directRequireMatch = directRequirePattern.exec(source);
        while (directRequireMatch) {
          calls.push({
            callerFile: filePath,
            calleeFile: binding.sourceFile,
            importKind: binding.kind,
            importedAs: binding.localName,
            importedName: 'module',
            callExpression: `${binding.localName}()`,
            line: lineNumberAt(source, directRequireMatch.index),
            relation: classifyDirectApiRelation(filePath, binding.sourceFile)
          });
          directRequireMatch = directRequirePattern.exec(source);
        }
      }

      continue;
    }

    const pattern = new RegExp(`\\b${escapeRegExp(binding.localName)}\\s*\\(`, 'g');
    let match = pattern.exec(source);
    while (match) {
      calls.push({
        callerFile: filePath,
        calleeFile: binding.sourceFile,
        importKind: binding.kind,
        importedAs: binding.localName,
        importedName: binding.importedName,
        callExpression: `${binding.localName}()`,
        line: lineNumberAt(source, match.index),
        relation: classifyDirectApiRelation(filePath, binding.sourceFile)
      });
      match = pattern.exec(source);
    }
  }

  return calls;
}

function aggregateDirectApiCalls(callEdges) {
  const grouped = new Map();

  for (const edge of callEdges) {
    const key = [
      edge.callerFile,
      edge.calleeFile,
      edge.callExpression,
      edge.importedName,
      edge.importKind,
      edge.relation
    ].join(':');

    if (!grouped.has(key)) {
      grouped.set(key, {
        callerFile: edge.callerFile,
        calleeFile: edge.calleeFile,
        callExpression: edge.callExpression,
        importedName: edge.importedName,
        importKind: edge.importKind,
        relation: edge.relation,
        callCount: 0,
        lines: []
      });
    }

    const current = grouped.get(key);
    current.callCount += 1;
    current.lines.push(edge.line);
  }

  return Array.from(grouped.values())
    .map((edge) => ({
      ...edge,
      lines: uniqueSorted(edge.lines.map((value) => String(value))).map((value) => Number(value))
    }))
    .sort((left, right) => {
      return [
        toRepoRelativePath(left.callerFile),
        left.callExpression,
        toRepoRelativePath(left.calleeFile)
      ].join(':').localeCompare([
        toRepoRelativePath(right.callerFile),
        right.callExpression,
        toRepoRelativePath(right.calleeFile)
      ].join(':'));
    });
}

function extractRendererImportMap(source) {
  const importMap = new Map();
  const pattern = /import\s*\{\s*([^}]+)\s*\}\s*from\s*['"](\.\/modules\/[^'"]+)['"]\s*;?/g;
  let match = pattern.exec(source);

  while (match) {
    const specifiers = match[1]
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const resolvedPath = resolveLocalSpecifier(moduleRuntimeFile, match[2]);

    for (const specifier of specifiers) {
      const specifierMatch = specifier.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (!specifierMatch) {
        continue;
      }
      const importedName = specifierMatch[1];
      const localName = specifierMatch[2] || importedName;
      importMap.set(localName, resolvedPath);
    }

    match = pattern.exec(source);
  }

  return importMap;
}

function extractRendererInitBlocks(source, initImportMap) {
  const initBlocks = [];
  const lines = source.split(/\r?\n/);
  let currentBlock = null;

  for (const line of lines) {
    if (!currentBlock) {
      // Inline form (current architecture in src/renderer/core/module-runtime.js):
      //   <localKey>: initAndRegisterModule(moduleRegistry, '<registryKey>', <initFn>, {
      const inlineMatch = line.match(
        /^\s*([A-Za-z_$][\w$]*)\s*:\s*initAndRegisterModule\s*\(\s*moduleRegistry\s*,\s*'([^']+)'\s*,\s*([A-Za-z_$][\w$]*)\s*,\s*\{/
      );

      if (inlineMatch && initImportMap.has(inlineMatch[3])) {
        currentBlock = {
          variableName: inlineMatch[1],
          initFunction: inlineMatch[3],
          sourceFile: initImportMap.get(inlineMatch[3]),
          registryKey: inlineMatch[2],
          callbackEdges: [],
          moduleRefEdges: [],
          braceDepth: countCharacters(line, '{') - countCharacters(line, '}')
        };
        continue;
      }

      // Legacy form (older renderer.js layout):
      //   const <var> = init<Module>({       or       <var> = init<Module>({
      const legacyMatch = line.match(/^\s*(?:const|let)?\s*([A-Za-z_$][\w$]*)\s*=\s*(init[A-Za-z_$][\w$]*)\s*\(\s*\{/)
        || line.match(/^\s*([A-Za-z_$][\w$]*)\s*=\s*(init[A-Za-z_$][\w$]*)\s*\(\s*\{/);

      if (legacyMatch && initImportMap.has(legacyMatch[2])) {
        currentBlock = {
          variableName: legacyMatch[1],
          initFunction: legacyMatch[2],
          sourceFile: initImportMap.get(legacyMatch[2]),
          registryKey: null,
          callbackEdges: [],
          moduleRefEdges: [],
          braceDepth: countCharacters(line, '{') - countCharacters(line, '}')
        };
        continue;
      }
    }

    if (!currentBlock) {
      continue;
    }

    const callbackPattern = /([A-Za-z_$][\w$]*)\s*:\s*rendererServices\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g;
    let callbackMatch = callbackPattern.exec(line);
    while (callbackMatch) {
      currentBlock.callbackEdges.push({
        variableName: currentBlock.variableName,
        sourceFile: currentBlock.sourceFile,
        optionName: callbackMatch[1],
        serviceName: callbackMatch[2],
        serviceMethod: callbackMatch[3]
      });
      callbackMatch = callbackPattern.exec(line);
    }

    const moduleRefPattern = /\bmodules\.([A-Za-z_$][\w$]*)\s*\??\.\s*([A-Za-z_$][\w$]*)\s*(?:\?\.)?\s*\(/g;
    let moduleRefMatch = moduleRefPattern.exec(line);
    while (moduleRefMatch) {
      currentBlock.moduleRefEdges.push({
        variableName: currentBlock.variableName,
        sourceFile: currentBlock.sourceFile,
        targetModuleKey: moduleRefMatch[1],
        targetMethod: moduleRefMatch[2]
      });
      moduleRefMatch = moduleRefPattern.exec(line);
    }

    currentBlock.braceDepth += countCharacters(line, '{') - countCharacters(line, '}');

    if (currentBlock.braceDepth <= 0 && /\}\s*\)\s*[;,]?/.test(line)) {
      initBlocks.push(currentBlock);
      currentBlock = null;
    }
  }

  return initBlocks;
}

function extractRegistryMappings(source) {
  const mappings = [];

  // Legacy form: moduleRegistry.register('key', varName)
  const legacyPattern = /moduleRegistry\.register\(\s*'([^']+)'\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g;
  let legacyMatch = legacyPattern.exec(source);
  while (legacyMatch) {
    mappings.push({
      registryKey: legacyMatch[1],
      variableName: legacyMatch[2]
    });
    legacyMatch = legacyPattern.exec(source);
  }

  // Inline form: <localKey>: initAndRegisterModule(moduleRegistry, '<registryKey>', ...)
  const inlinePattern = /([A-Za-z_$][\w$]*)\s*:\s*initAndRegisterModule\s*\(\s*moduleRegistry\s*,\s*'([^']+)'/g;
  let inlineMatch = inlinePattern.exec(source);
  while (inlineMatch) {
    mappings.push({
      registryKey: inlineMatch[2],
      variableName: inlineMatch[1]
    });
    inlineMatch = inlinePattern.exec(source);
  }

  return dedupeRecords(
    mappings,
    (mapping) => `${mapping.registryKey}:${mapping.variableName}`
  );
}

function extractManifestInitBlocks() {
  return walkFiles(rendererManifestsRoot)
    .filter((filePath) => !filePath.endsWith(`${path.sep}index.js`))
    .filter((filePath) => !filePath.endsWith(`${path.sep}runtime.js`))
    .flatMap((filePath) => {
      const source = fs.readFileSync(filePath, 'utf8');
      const importMap = new Map();
      const importPattern = /import\s*\{\s*([^}]+)\s*\}\s*from\s*['"](\.\.\/modules\/[^'"]+)['"]\s*;?/g;
      let importMatch = importPattern.exec(source);
      while (importMatch) {
        const resolvedPath = resolveLocalSpecifier(filePath, importMatch[2]);
        importMatch[1]
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
          .forEach((specifier) => {
            const match = specifier.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
            if (match) {
              importMap.set(match[2] || match[1], resolvedPath);
            }
          });
        importMatch = importPattern.exec(source);
      }

      const manifestPattern = /export\s+const\s+([A-Za-z_$][\w$]*Manifest)\s*=\s*\{([\s\S]*?)\n\};/g;
      const blocks = [];
      let manifestMatch = manifestPattern.exec(source);
      while (manifestMatch) {
        const body = manifestMatch[2];
        const key = body.match(/\bkey\s*:\s*['"]([^'"]+)['"]/)?.[1] || '';
        const initFunction = body.match(/\binit\s*:\s*([A-Za-z_$][\w$]*)/)?.[1] || '';
        if (key && initFunction) {
          const callbackEdges = [];
          const callbackPattern = /([A-Za-z_$][\w$]*)\s*:\s*rendererServices\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g;
          let callbackMatch = callbackPattern.exec(body);
          while (callbackMatch) {
            callbackEdges.push({
              variableName: key,
              sourceFile: importMap.get(initFunction) || filePath,
              optionName: callbackMatch[1],
              serviceName: callbackMatch[2],
              serviceMethod: callbackMatch[3]
            });
            callbackMatch = callbackPattern.exec(body);
          }

          const moduleRefEdges = [];
          const moduleRefPattern = /\bmodules\??\.([A-Za-z_$][\w$]*)\s*\??\.\s*([A-Za-z_$][\w$]*)\s*(?:\?\.)?\s*\(/g;
          let moduleRefMatch = moduleRefPattern.exec(body);
          while (moduleRefMatch) {
            moduleRefEdges.push({
              variableName: key,
              sourceFile: importMap.get(initFunction) || filePath,
              targetModuleKey: moduleRefMatch[1],
              targetMethod: moduleRefMatch[2]
            });
            moduleRefMatch = moduleRefPattern.exec(body);
          }

          blocks.push({
            variableName: key,
            registryKey: key,
            initFunction,
            sourceFile: importMap.get(initFunction) || filePath,
            callbackEdges,
            moduleRefEdges
          });
        }
        manifestMatch = manifestPattern.exec(source);
      }
      return blocks;
    });
}

function extractFunctionBodies(source) {
  const functions = [];
  const pattern = /function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
  let match = pattern.exec(source);

  while (match) {
    const openingBraceIndex = pattern.lastIndex - 1;
    let cursor = openingBraceIndex + 1;
    let depth = 1;

    while (cursor < source.length && depth > 0) {
      const char = source[cursor];
      if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
      }
      cursor += 1;
    }

    functions.push({
      name: match[1],
      body: source.slice(openingBraceIndex + 1, cursor - 1)
    });

    match = pattern.exec(source);
  }

  return functions;
}

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

function extractServiceFanOut(filePath, source) {
  const fileName = path.basename(filePath, '.js');
  const serviceName = fileName.replace(/Service$/, '');
  const capitalizedServiceName = serviceName.charAt(0).toUpperCase() + serviceName.slice(1);
  const outerFactoryName = `create${capitalizedServiceName}Service`;
  const functions = extractFunctionBodies(source)
    .filter((entry) => entry.name !== outerFactoryName);
  const edges = [];

  for (const entry of functions) {
    const aliasMap = new Map();
    const aliasPattern = /const\s+([A-Za-z_$][\w$]*)\s*=\s*registry\.get\(\s*'([^']+)'\s*\)\s*;/g;
    let aliasMatch = aliasPattern.exec(entry.body);

    while (aliasMatch) {
      aliasMap.set(aliasMatch[1], aliasMatch[2]);
      aliasMatch = aliasPattern.exec(entry.body);
    }

    const directPattern = /registry\.get\(\s*'([^']+)'\s*\)\.([A-Za-z_$][\w$]*)\s*(?:\?\.)?\s*\(/g;
    let directMatch = directPattern.exec(entry.body);
    while (directMatch) {
      edges.push({
        serviceName,
        serviceMethod: entry.name,
        targetKey: directMatch[1],
        targetMethod: directMatch[2]
      });
      directMatch = directPattern.exec(entry.body);
    }

    for (const [aliasName, targetKey] of aliasMap.entries()) {
      const aliasCallPattern = new RegExp(`\\b${aliasName}\\.([A-Za-z_$][\\w$]*)\\s*(?:\\?\\.)?\\s*\\(`, 'g');
      let aliasCallMatch = aliasCallPattern.exec(entry.body);
      while (aliasCallMatch) {
        edges.push({
          serviceName,
          serviceMethod: entry.name,
          targetKey,
          targetMethod: aliasCallMatch[1]
        });
        aliasCallMatch = aliasCallPattern.exec(entry.body);
      }

      const aliasInvokePattern = new RegExp(`\\b${aliasName}\\s*\\(`, 'g');
      let aliasInvokeMatch = aliasInvokePattern.exec(entry.body);
      while (aliasInvokeMatch) {
        edges.push({
          serviceName,
          serviceMethod: entry.name,
          targetKey,
          targetMethod: 'invoke'
        });
        aliasInvokeMatch = aliasInvokePattern.exec(entry.body);
      }
    }
  }

  return dedupeRecords(
    edges,
    (edge) => `${edge.serviceName}:${edge.serviceMethod}:${edge.targetKey}:${edge.targetMethod}`
  ).sort((left, right) => {
    return `${left.serviceName}:${left.serviceMethod}:${left.targetKey}:${left.targetMethod}`
      .localeCompare(`${right.serviceName}:${right.serviceMethod}:${right.targetKey}:${right.targetMethod}`);
  });
}

function buildRegisteredModules(registryMappings, initBlocks) {
  const blockByVariableName = new Map(initBlocks.map((entry) => [entry.variableName, entry]));
  return registryMappings
    .map((mapping) => {
      const initBlock = blockByVariableName.get(mapping.variableName);
      return {
        registryKey: mapping.registryKey,
        variableName: mapping.variableName,
        sourceFile: initBlock?.sourceFile || null,
        initFunction: initBlock?.initFunction || null
      };
    })
    .sort((left, right) => left.registryKey.localeCompare(right.registryKey));
}

function deriveCommunicationEdges(callbackEdges, serviceFanOutEdges, registeredModules) {
  const registryByVariableName = new Map(registeredModules.map((entry) => [entry.variableName, entry]));
  const registryByKey = new Map(registeredModules.map((entry) => [entry.registryKey, entry]));
  const fanOutByServiceMethod = new Map();

  for (const edge of serviceFanOutEdges) {
    const key = `${edge.serviceName}.${edge.serviceMethod}`;
    const current = fanOutByServiceMethod.get(key) || [];
    current.push(edge);
    fanOutByServiceMethod.set(key, current);
  }

  const moduleEdges = [];
  const bridgeEdges = [];

  for (const callbackEdge of callbackEdges) {
    const sourceModule = registryByVariableName.get(callbackEdge.variableName);
    if (!sourceModule) {
      continue;
    }

    const serviceKey = `${callbackEdge.serviceName}.${callbackEdge.serviceMethod}`;
    const fanOutEdges = fanOutByServiceMethod.get(serviceKey) || [];

    for (const fanOutEdge of fanOutEdges) {
      const targetModule = registryByKey.get(fanOutEdge.targetKey);
      const record = {
        fromRegistryKey: sourceModule.registryKey,
        fromFile: sourceModule.sourceFile,
        callbackOption: callbackEdge.optionName,
        serviceName: callbackEdge.serviceName,
        serviceMethod: callbackEdge.serviceMethod,
        targetKey: fanOutEdge.targetKey,
        targetMethod: fanOutEdge.targetMethod,
        toRegistryKey: targetModule?.registryKey || null,
        toFile: targetModule?.sourceFile || null
      };

      if (targetModule) {
        moduleEdges.push(record);
      } else {
        bridgeEdges.push(record);
      }
    }
  }

  return {
    moduleEdges: dedupeRecords(
      moduleEdges,
      (edge) => [
        edge.fromRegistryKey,
        edge.callbackOption,
        edge.serviceName,
        edge.serviceMethod,
        edge.toRegistryKey,
        edge.targetMethod
      ].join(':')
    ).sort((left, right) => {
      return [
        left.fromRegistryKey,
        left.serviceName,
        left.serviceMethod,
        left.toRegistryKey,
        left.targetMethod
      ].join(':').localeCompare([
        right.fromRegistryKey,
        right.serviceName,
        right.serviceMethod,
        right.toRegistryKey,
        right.targetMethod
      ].join(':'));
    }),
    bridgeEdges: dedupeRecords(
      bridgeEdges,
      (edge) => [
        edge.fromRegistryKey,
        edge.callbackOption,
        edge.serviceName,
        edge.serviceMethod,
        edge.targetKey,
        edge.targetMethod
      ].join(':')
    ).sort((left, right) => {
      return [
        left.fromRegistryKey,
        left.serviceName,
        left.serviceMethod,
        left.targetKey,
        left.targetMethod
      ].join(':').localeCompare([
        right.fromRegistryKey,
        right.serviceName,
        right.serviceMethod,
        right.targetKey,
        right.targetMethod
      ].join(':'));
    })
  };
}

function formatPathList(paths) {
  return paths.map((value) => `\`${value}\``).join(', ');
}

function formatLineList(lines) {
  return lines.map((value) => `L${value}`).join(', ');
}

function buildReport({
  fileDependencyMap,
  directApiCalls,
  wrapperDelegationEdges,
  registeredModules,
  callbackEdges,
  serviceFanOutEdges,
  derivedModuleEdges,
  derivedBridgeEdges,
  directModuleRefEdges
}) {
  const generatedAt = new Date().toISOString();
  const filePaths = Array.from(fileDependencyMap.keys()).sort((left, right) => left.localeCompare(right));
  const importEdgeCount = Array.from(fileDependencyMap.values()).reduce((sum, list) => sum + list.length, 0);
  const reportLines = [
    '# Project Module Relationship Report',
    '',
    '> Auto-generated by `scripts/report-module-relationships.mjs`.',
    '',
    `Generated at: \`${generatedAt}\``,
    '',
    '## Summary',
    '',
    `- Files analyzed: ${filePaths.length}`,
    `- Local import dependency edges: ${importEdgeCount}`,
    `- Direct imported API edges: ${directApiCalls.length}`,
    `- Renderer composition direct API edges: ${wrapperDelegationEdges.length}`,
    `- Registered top-level modules: ${registeredModules.length}`,
    `- Renderer callback wiring edges: ${callbackEdges.length}`,
    `- Service fan-out edges: ${serviceFanOutEdges.length}`,
    `- Derived module-to-module API edges: ${derivedModuleEdges.length}`,
    `- Derived module-to-bridge API edges: ${derivedBridgeEdges.length}`,
    `- Direct module-to-module callback refs: ${directModuleRefEdges.length}`,
    '',
    '## Direct Imported API Communication',
    '',
    '| Caller file | Call expression | Callee file | Relation | Calls | Lines |',
    '| --- | --- | --- | --- | --- | --- |'
  ];

  for (const edge of directApiCalls) {
    reportLines.push(
      `| \`${toRepoRelativePath(edge.callerFile)}\` | \`${edge.callExpression}\` | \`${toRepoRelativePath(edge.calleeFile)}\` | ${edge.relation} | ${edge.callCount} | ${formatLineList(edge.lines)} |`
    );
  }

  reportLines.push(
    '',
    '## Wrapper / Adapter Direct API Communication',
    '',
    '| Wrapper file | Call expression | Internal target | Calls | Lines |',
    '| --- | --- | --- | --- | --- |'
  );

  for (const edge of wrapperDelegationEdges) {
    reportLines.push(
      `| \`${toRepoRelativePath(edge.callerFile)}\` | \`${edge.callExpression}\` | \`${toRepoRelativePath(edge.calleeFile)}\` | ${edge.callCount} | ${formatLineList(edge.lines)} |`
    );
  }

  reportLines.push(
    '',
    '## Registered Top-Level Modules',
    '',
    '| Registry key | Source file |',
    '| --- | --- |'
  );

  for (const moduleRecord of registeredModules) {
    reportLines.push(`| \`${moduleRecord.registryKey}\` | \`${toRepoRelativePath(moduleRecord.sourceFile || moduleRuntimeFile)}\` |`);
  }

  reportLines.push(
    '',
    '## Renderer Callback Wiring',
    '',
    '| Source module | Source file | Callback option | Service method |',
    '| --- | --- | --- | --- |'
  );

  const callbackRows = callbackEdges
    .map((edge) => ({
      ...edge,
      sourceModule: registeredModules.find((entry) => entry.variableName === edge.variableName)?.registryKey || edge.variableName
    }))
    .sort((left, right) => {
      return [
        left.sourceModule,
        left.optionName,
        left.serviceName,
        left.serviceMethod
      ].join(':').localeCompare([
        right.sourceModule,
        right.optionName,
        right.serviceName,
        right.serviceMethod
      ].join(':'));
    });

  for (const edge of callbackRows) {
    reportLines.push(
      `| \`${edge.sourceModule}\` | \`${toRepoRelativePath(edge.sourceFile)}\` | \`${edge.optionName}\` | \`${edge.serviceName}.${edge.serviceMethod}()\` |`
    );
  }

  reportLines.push(
    '',
    '## Service Fan-Out',
    '',
    '| Service method | Target key | Target API | Target type |',
    '| --- | --- | --- | --- |'
  );

  const registeredKeys = new Set(registeredModules.map((entry) => entry.registryKey));
  for (const edge of serviceFanOutEdges) {
    const targetType = registeredKeys.has(edge.targetKey) ? 'module' : 'bridge';
    reportLines.push(
      `| \`${edge.serviceName}.${edge.serviceMethod}()\` | \`${edge.targetKey}\` | \`${edge.targetMethod}()\` | ${targetType} |`
    );
  }

  reportLines.push(
    '',
    '## Derived Module-to-Module API Communication',
    '',
    '| From module | Callback option | Via service | To module | Target API |',
    '| --- | --- | --- | --- | --- |'
  );

  for (const edge of derivedModuleEdges) {
    reportLines.push(
      `| \`${edge.fromRegistryKey}\` | \`${edge.callbackOption}\` | \`${edge.serviceName}.${edge.serviceMethod}()\` | \`${edge.toRegistryKey}\` | \`${edge.targetMethod}()\` |`
    );
  }

  reportLines.push(
    '',
    '## Derived Module-to-Bridge API Communication',
    '',
    '| From module | Callback option | Via service | Bridge target | Target API |',
    '| --- | --- | --- | --- | --- |'
  );

  for (const edge of derivedBridgeEdges) {
    reportLines.push(
      `| \`${edge.fromRegistryKey}\` | \`${edge.callbackOption}\` | \`${edge.serviceName}.${edge.serviceMethod}()\` | \`${edge.targetKey}\` | \`${edge.targetMethod}()\` |`
    );
  }

  reportLines.push(
    '',
    '## Direct Module-to-Module Wiring (callback bodies)',
    '',
    '> Direct cross-module references inside renderer init/options callbacks (`modules.<key>.<method>(...)`).',
    '> These bypass the renderer service layer and indicate tight coupling between modules.',
    '',
    '| From module | From file | To module | Target API |',
    '| --- | --- | --- | --- |'
  );

  for (const edge of directModuleRefEdges) {
    reportLines.push(
      `| \`${edge.fromRegistryKey || edge.variableName}\` | \`${toRepoRelativePath(edge.sourceFile)}\` | \`${edge.targetModuleKey}\` | \`${edge.targetMethod}()\` |`
    );
  }

  reportLines.push(
    '',
    '## Local Import Dependencies',
    ''
  );

  for (const filePath of filePaths) {
    const dependencies = fileDependencyMap.get(filePath) || [];
    if (!dependencies.length) {
      continue;
    }
    reportLines.push(`- \`${filePath}\` -> ${formatPathList(dependencies)}`);
  }

  reportLines.push(
    '',
    '## Notes',
    '',
    '- The dependency section is based on local `import` and `export ... from` statements under `src`.',
    '- The direct imported API section records non-registry calls made through local imports, including explicit public APIs and pure feature modules.',
    '- The renderer-specific API communication sections are inferred from `src/renderer/module-manifests/*.js` callback wiring and `src/renderer/services/*.js` registry fan-out calls.',
    '- Manifest declarations are the preferred registration source. The older inline and legacy `module-runtime.js` forms remain supported for historical reports.',
    '- The "Direct Module-to-Module Wiring" section captures `modules.<key>.<method>(...)` calls inside callback bodies that bypass the renderer service layer.',
    '- Bridge targets are registry entries such as `showView`, `VIEWS`, or `setSearchInputValue` that are not registered app modules.'
  );

  return `${reportLines.join('\n')}\n`;
}

function main() {
  const { outputPath } = parseArguments(process.argv.slice(2));
  const sourceFiles = walkFiles(srcRoot);

  const fileDependencyMap = new Map();
  const directApiCallEdges = [];
  for (const filePath of sourceFiles) {
    const source = fs.readFileSync(filePath, 'utf8');
    const dependencies = extractLocalImports(filePath, source)
      .filter((dependencyPath) => dependencyPath.startsWith(srcRoot))
      .map((dependencyPath) => toRepoRelativePath(dependencyPath));
    fileDependencyMap.set(toRepoRelativePath(filePath), dependencies);
    directApiCallEdges.push(...extractDirectImportedApiCalls(filePath, source));
  }

  const directApiCalls = aggregateDirectApiCalls(directApiCallEdges);
  const wrapperDelegationEdges = directApiCalls.filter((edge) => edge.relation === 'renderer composition/internal');

  const rendererSource = fs.readFileSync(moduleRuntimeFile, 'utf8');
  const manifestInitBlocks = extractManifestInitBlocks();
  const initImportMap = extractRendererImportMap(rendererSource);
  const legacyInitBlocks = extractRendererInitBlocks(rendererSource, initImportMap);
  const initBlocks = manifestInitBlocks.length ? manifestInitBlocks : legacyInitBlocks;
  const registryMappings = manifestInitBlocks.length
    ? manifestInitBlocks.map((entry) => ({
      registryKey: entry.registryKey,
      variableName: entry.variableName
    }))
    : extractRegistryMappings(rendererSource);
  const registeredModules = buildRegisteredModules(registryMappings, initBlocks);
  const callbackEdges = initBlocks
    .flatMap((entry) => entry.callbackEdges)
    .sort((left, right) => {
      return [
        left.variableName,
        left.optionName,
        left.serviceName,
        left.serviceMethod
      ].join(':').localeCompare([
        right.variableName,
        right.optionName,
        right.serviceName,
        right.serviceMethod
      ].join(':'));
    });

  const registryKeyByVariableName = new Map(
    registeredModules.map((entry) => [entry.variableName, entry.registryKey])
  );
  const directModuleRefEdges = dedupeRecords(
    initBlocks
      .flatMap((entry) => entry.moduleRefEdges || [])
      .map((edge) => ({
        ...edge,
        fromRegistryKey: registryKeyByVariableName.get(edge.variableName) || null
      })),
    (edge) => `${edge.variableName}:${edge.targetModuleKey}:${edge.targetMethod}`
  ).sort((left, right) => {
    return [
      left.fromRegistryKey || left.variableName,
      left.targetModuleKey,
      left.targetMethod
    ].join(':').localeCompare([
      right.fromRegistryKey || right.variableName,
      right.targetModuleKey,
      right.targetMethod
    ].join(':'));
  });

  const serviceFiles = walkFiles(rendererServicesRoot)
    .filter((filePath) => /Service\.js$/.test(filePath));
  const serviceFanOutEdges = serviceFiles.flatMap((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    return extractServiceFanOut(filePath, source);
  });

  const { moduleEdges: derivedModuleEdges, bridgeEdges: derivedBridgeEdges } = deriveCommunicationEdges(
    callbackEdges,
    serviceFanOutEdges,
    registeredModules
  );

  const report = buildReport({
    fileDependencyMap,
    directApiCalls,
    wrapperDelegationEdges,
    registeredModules,
    callbackEdges,
    serviceFanOutEdges,
    derivedModuleEdges,
    derivedBridgeEdges,
    directModuleRefEdges
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, report, 'utf8');
  console.log(`Wrote module relationship report to ${outputPath}`);
}

main();

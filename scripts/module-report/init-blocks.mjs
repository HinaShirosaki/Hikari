import fs from 'node:fs';
import path from 'node:path';
import { countCharacters, dedupeRecords, resolveLocalSpecifier, walkFiles } from './source-scan.mjs';
import { moduleRuntimeFile, rendererManifestsRoot } from './paths.mjs';

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

export {
  extractRendererImportMap,
  extractRendererInitBlocks,
  extractRegistryMappings,
  extractManifestInitBlocks,
  extractFunctionBodies
};

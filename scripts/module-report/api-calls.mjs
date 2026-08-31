import { describeSourceArea, isTopLevelRendererModuleFile } from './module-areas.mjs';
import { escapeRegExp, extractImportBindings, lineNumberAt } from './source-scan.mjs';
import { srcRoot } from './paths.mjs';

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

export {
  extractDirectImportedApiCalls
};

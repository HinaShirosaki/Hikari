import path from 'node:path';
import { CODE_FILE_PATTERN, analyzeSnapshot, validateImports } from './source-analysis.mjs';

function sorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function issueKey(issue) {
  return [issue.type, issue.filePath, issue.specifier || issue.target || '', issue.importedName || ''].join(':');
}

function functionKey(record) {
  return [record.filePath, record.name, record.fingerprint, record.scope || ''].join(':');
}

function flattenFunctions(analyses) {
  const results = [];
  analyses.forEach((analysis) => {
    analysis.functions.forEach((entry) => results.push({ ...entry, filePath: analysis.filePath }));
  });
  return results;
}

function isFunctionExported(analysis, functionName) {
  if (!analysis) return [];
  return analysis.exportRecords
    .filter((record) => record.localName === functionName)
    .map((record) => record.exportedName);
}

function buildInboundMap(analyses) {
  const inbound = new Map();
  analyses.forEach((analysis) => {
    analysis.imports.forEach((edge) => {
      if (!edge.target) return;
      if (!inbound.has(edge.target)) inbound.set(edge.target, []);
      inbound.get(edge.target).push({
        from: analysis.filePath,
        kind: edge.kind,
        line: edge.line,
        bindings: edge.bindings
      });
    });
  });
  return inbound;
}

function dependenciesOf(analysis) {
  if (!analysis) return [];
  return sorted(analysis.imports.map((edge) => edge.target).filter(Boolean));
}

function reachableAddedDependencies(ownerAnalysis, analyses, addedCodeFiles) {
  const direct = dependenciesOf(ownerAnalysis).filter((filePath) => addedCodeFiles.has(filePath));
  const reachable = new Set(direct);
  const queue = [...direct];
  while (queue.length) {
    const filePath = queue.shift();
    dependenciesOf(analyses.get(filePath)).forEach((dependency) => {
      if (!addedCodeFiles.has(dependency) || reachable.has(dependency)) return;
      reachable.add(dependency);
      queue.push(dependency);
    });
  }
  return { direct: new Set(direct), reachable };
}

function compareSnapshots({ baselineRef, beforeFiles, afterFiles, fileChanges }) {
  const beforeAnalyses = analyzeSnapshot(beforeFiles);
  const afterAnalyses = analyzeSnapshot(afterFiles);
  const beforeIssues = validateImports(beforeAnalyses);
  const afterIssues = validateImports(afterAnalyses);
  const beforeIssueKeys = new Set(beforeIssues.map(issueKey));
  const newImportIssues = afterIssues.filter((issue) => !beforeIssueKeys.has(issueKey(issue)));
  const resolvedImportIssues = beforeIssues.filter((issue) => (
    !new Set(afterIssues.map(issueKey)).has(issueKey(issue))
  ));

  const modifiedCodeFiles = fileChanges.modified.filter((filePath) => CODE_FILE_PATTERN.test(filePath));
  const addedCodeFiles = new Set(fileChanges.added.filter((filePath) => CODE_FILE_PATTERN.test(filePath)));
  const afterFunctions = flattenFunctions(afterAnalyses);
  const afterByFingerprint = new Map();
  const afterByName = new Map();
  afterFunctions.forEach((entry) => {
    if (!afterByFingerprint.has(entry.fingerprint)) afterByFingerprint.set(entry.fingerprint, []);
    afterByFingerprint.get(entry.fingerprint).push(entry);
    if (!afterByName.has(entry.name)) afterByName.set(entry.name, []);
    afterByName.get(entry.name).push(entry);
  });

  const movedFunctions = [];
  const missingFunctions = [];
  const seenBeforeFunctions = new Set();
  modifiedCodeFiles.forEach((owner) => {
    const before = beforeAnalyses.get(owner);
    const after = afterAnalyses.get(owner);
    if (!before) return;
    const candidateDestinations = reachableAddedDependencies(after, afterAnalyses, addedCodeFiles);
    before.functions.forEach((fn) => {
      const key = functionKey({ ...fn, filePath: owner });
      if (seenBeforeFunctions.has(key)) return;
      seenBeforeFunctions.add(key);
      const stillInOwner = after?.functions.some((candidate) => candidate.name === fn.name);
      if (stillInOwner) return;
      const publicNames = isFunctionExported(before, fn.name);
      const exactMatches = (afterByFingerprint.get(fn.fingerprint) || [])
        .filter((candidate) => candidateDestinations.reachable.has(candidate.filePath));
      const allNameMatches = exactMatches.length
        ? []
        : (afterByName.get(fn.name) || []).filter((candidate) => candidateDestinations.reachable.has(candidate.filePath));
      const directNameMatches = allNameMatches.filter((candidate) => candidateDestinations.direct.has(candidate.filePath));
      const nameMatches = directNameMatches.length ? directNameMatches : allNameMatches;
      const matches = exactMatches.length ? exactMatches : nameMatches;
      if (!matches.length) {
        missingFunctions.push({
          owner,
          name: fn.name,
          beforeLine: fn.line,
          scope: fn.scope,
          publicNames,
          apiPreserved: publicNames.every((name) => after?.effectiveExports.has(name))
        });
        return;
      }
      matches.forEach((destination) => {
        const destinationAnalysis = afterAnalyses.get(destination.filePath);
        movedFunctions.push({
          owner,
          name: fn.name,
          beforeLine: fn.line,
          scope: fn.scope,
          destination: destination.filePath,
          afterLine: destination.line,
          confidence: exactMatches.length ? 'exact-body' : 'name-only',
          destinationIsNew: addedCodeFiles.has(destination.filePath),
          destinationExports: isFunctionExported(destinationAnalysis, destination.name),
          publicNames,
          apiPreserved: publicNames.every((name) => after?.effectiveExports.has(name))
        });
      });
    });
  });

  const beforeInbound = buildInboundMap(beforeAnalyses);
  const afterInbound = buildInboundMap(afterAnalyses);
  const lostExports = [];
  modifiedCodeFiles.forEach((filePath) => {
    const before = beforeAnalyses.get(filePath);
    const after = afterAnalyses.get(filePath);
    if (!before || !after) return;
    sorted(before.effectiveExports).forEach((exportedName) => {
      if (!after.effectiveExports.has(exportedName)) {
        const beforeConsumers = (beforeInbound.get(filePath) || []).filter((edge) => (
          edge.bindings.some((binding) => binding.importedName === exportedName || binding.importedName === '*')
        ));
        const afterConsumers = (afterInbound.get(filePath) || []).filter((edge) => (
          edge.bindings.some((binding) => binding.importedName === exportedName || binding.importedName === '*')
        ));
        lostExports.push({
          filePath,
          exportedName,
          beforeConsumers: sorted(beforeConsumers.map((edge) => edge.from)),
          afterConsumers: sorted(afterConsumers.map((edge) => edge.from)),
          publicEntrypoint: /(?:^|\/)(?:index|public-api)\.(?:c?js|mjs)$/.test(filePath)
        });
      }
    });
  });

  const lostExportMap = new Map(
    lostExports.map((entry) => [`${entry.filePath}:${entry.exportedName}`, entry])
  );
  missingFunctions.forEach((entry) => {
    const relatedLostExports = entry.publicNames
      .map((name) => lostExportMap.get(`${entry.owner}:${name}`))
      .filter(Boolean);
    if (!entry.publicNames.length) {
      entry.classification = 'internal removal; verify intentional';
    } else if (relatedLostExports.length
      && relatedLostExports.every((lost) => !lost.afterConsumers.length && !lost.publicEntrypoint)) {
      entry.classification = 'retired internal export; former consumers no longer import it';
    } else {
      entry.classification = 'public API compatibility risk';
    }
  });

  const dependencyChanges = modifiedCodeFiles.map((filePath) => {
    const beforeDependencies = dependenciesOf(beforeAnalyses.get(filePath));
    const afterDependencies = dependenciesOf(afterAnalyses.get(filePath));
    const beforeSet = new Set(beforeDependencies);
    const afterSet = new Set(afterDependencies);
    return {
      filePath,
      added: afterDependencies.filter((entry) => !beforeSet.has(entry)),
      removed: beforeDependencies.filter((entry) => !afterSet.has(entry)),
      before: beforeDependencies,
      after: afterDependencies
    };
  }).filter((entry) => entry.added.length || entry.removed.length);

  const inbound = afterInbound;
  const packageMain = (() => {
    try { return JSON.parse(afterFiles.get('package.json') || '{}').main || ''; } catch { return ''; }
  })();
  const orphanAddedModules = sorted(addedCodeFiles)
    .filter((filePath) => filePath !== packageMain && !inbound.has(filePath))
    .map((filePath) => ({
    filePath,
    exports: sorted(afterAnalyses.get(filePath)?.effectiveExports || []),
    functions: sorted((afterAnalyses.get(filePath)?.functions || []).map((entry) => entry.name))
  }));

  const duplicateMovedBodies = [];
  const movedCandidates = new Map();
  movedFunctions.forEach((entry) => {
    const key = `${entry.owner}:${entry.name}:${entry.beforeLine}`;
    if (!movedCandidates.has(key)) movedCandidates.set(key, []);
    movedCandidates.get(key).push(entry);
  });
  movedCandidates.forEach((entries) => {
    const distinctFiles = sorted(entries.map((entry) => entry.destination));
    if (distinctFiles.length > 1) {
      duplicateMovedBodies.push({
        fingerprint: '',
        name: entries[0].name,
        owner: entries[0].owner,
        beforeLine: entries[0].beforeLine,
        confidence: entries[0].confidence,
        locations: entries.map((entry) => ({
          filePath: entry.destination,
          line: entry.afterLine,
          name: entry.name
        }))
      });
    }
  });

  const splitPairMap = new Map();
  movedFunctions.filter((entry) => entry.destinationIsNew).forEach((entry) => {
    const key = `${entry.owner}->${entry.destination}`;
    if (!splitPairMap.has(key)) {
      splitPairMap.set(key, {
        owner: entry.owner,
        destination: entry.destination,
        functions: [],
        confidences: new Set()
      });
    }
    splitPairMap.get(key).functions.push(entry.name);
    splitPairMap.get(key).confidences.add(entry.confidence);
  });
  const splitPairs = [...splitPairMap.values()].map((entry) => ({
    owner: entry.owner,
    destination: entry.destination,
    functions: sorted(entry.functions),
    confidence: [...entry.confidences].sort().join(', ')
  })).sort((left, right) => `${left.owner}:${left.destination}`.localeCompare(`${right.owner}:${right.destination}`));

  const splitFiles = new Set();
  splitPairs.forEach((entry) => {
    splitFiles.add(entry.owner);
    splitFiles.add(entry.destination);
  });
  dependencyChanges.forEach((entry) => {
    entry.added.filter((target) => addedCodeFiles.has(target)).forEach((target) => {
      splitFiles.add(entry.filePath);
      splitFiles.add(target);
    });
  });
  const splitEdges = [];
  afterAnalyses.forEach((analysis) => {
    if (!splitFiles.has(analysis.filePath)) return;
    analysis.imports.forEach((edge) => {
      if (!edge.target || !splitFiles.has(edge.target)) return;
      splitEdges.push({
        from: analysis.filePath,
        to: edge.target,
        kind: edge.kind,
        bindings: edge.bindings.map((binding) => binding.importedName)
      });
    });
  });

  const splitInventory = sorted(splitFiles).map((filePath) => {
    const analysis = afterAnalyses.get(filePath);
    return {
      filePath,
      change: addedCodeFiles.has(filePath) ? 'added' : 'modified',
      exports: sorted(analysis?.effectiveExports || []),
      functions: (analysis?.functions || []).map((entry) => ({ name: entry.name, line: entry.line, scope: entry.scope })),
      imports: (analysis?.imports || []).filter((edge) => edge.target).map((edge) => ({
        target: edge.target,
        kind: edge.kind,
        line: edge.line,
        bindings: edge.bindings.map((binding) => binding.importedName)
      })),
      inbound: inbound.get(filePath) || []
    };
  });

  let beforeMain = '';
  let afterMain = '';
  try { beforeMain = JSON.parse(beforeFiles.get('package.json') || '{}').main || ''; } catch {}
  try { afterMain = JSON.parse(afterFiles.get('package.json') || '{}').main || ''; } catch {}

  return {
    baselineRef,
    generatedAt: new Date().toISOString(),
    packageEntrypoint: { before: beforeMain, after: afterMain },
    summary: {
      beforeCodeFiles: beforeAnalyses.size,
      afterCodeFiles: afterAnalyses.size,
      addedCodeFiles: addedCodeFiles.size,
      modifiedCodeFiles: modifiedCodeFiles.length,
      deletedCodeFiles: fileChanges.deleted.filter((filePath) => CODE_FILE_PATTERN.test(filePath)).length,
      beforeImportIssues: beforeIssues.length,
      afterImportIssues: afterIssues.length,
      newImportIssues: newImportIssues.length,
      exactMovedFunctions: movedFunctions.filter((entry) => entry.confidence === 'exact-body').length,
      nameOnlyMovedFunctions: movedFunctions.filter((entry) => entry.confidence === 'name-only').length,
      missingFunctions: missingFunctions.length,
      lostExports: lostExports.length,
      lostExportsWithConsumers: lostExports.filter((entry) => entry.afterConsumers.length || entry.publicEntrypoint).length,
      orphanAddedModules: orphanAddedModules.length,
      splitPairs: splitPairs.length
    },
    fileChanges,
    beforeIssues,
    afterIssues,
    newImportIssues,
    resolvedImportIssues,
    movedFunctions,
    missingFunctions,
    lostExports,
    dependencyChanges,
    orphanAddedModules,
    duplicateMovedBodies,
    splitPairs,
    splitEdges,
    splitInventory
  };
}

export { compareSnapshots };

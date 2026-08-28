import path from 'node:path';
import { dedupeRecords, toRepoRelativePath, uniqueSorted } from './source-scan.mjs';
import { extractFunctionBodies } from './init-blocks.mjs';

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

export {
  aggregateDirectApiCalls,
  extractServiceFanOut,
  buildRegisteredModules,
  deriveCommunicationEdges
};

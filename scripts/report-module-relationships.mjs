import fs from 'node:fs';
import path from 'node:path';
import { extractDirectImportedApiCalls } from './module-report/api-calls.mjs';
import { parseArguments } from './module-report/cli.mjs';
import { extractManifestInitBlocks, extractRegistryMappings, extractRendererImportMap, extractRendererInitBlocks } from './module-report/init-blocks.mjs';
import { aggregateDirectApiCalls, buildRegisteredModules, deriveCommunicationEdges, extractServiceFanOut } from './module-report/communication-edges.mjs';
import { buildReport } from './module-report/report.mjs';
import { dedupeRecords, extractLocalImports, toRepoRelativePath, walkFiles } from './module-report/source-scan.mjs';
import { moduleRuntimeFile, rendererServicesRoot, srcRoot } from './module-report/paths.mjs';

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

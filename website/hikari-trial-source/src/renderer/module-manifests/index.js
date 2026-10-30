// Each manifest is imported on its own so a module that fails to load (missing
// file, syntax error) is reported and skipped instead of failing the whole
// renderer module graph. runtime.js fences init/render the same way; this
// extends that isolation to load time. Loads are sequential to keep evaluation
// order identical to the former static imports.
async function loadManifests(entries) {
  const manifests = [];
  for (const [specifier, exportName] of entries) {
    try {
      manifests.push((await import(specifier))[exportName]);
    } catch (error) {
      console.error(`Module manifest "${specifier}" failed to load:`, error);
    }
  }
  return manifests;
}

export const foundationModuleManifests = await loadManifests([
  ['./biology-notebook.js', 'biologyNotebookManifest'],
  ['./protocol.js', 'protocolManifest']
]);

export const collaborationModuleManifests = await loadManifests([
  ['./agent-chat-rail.js', 'agentChatRailManifest'],
  ['./papers.js', 'papersManifest']
]);

export const inventoryModuleManifests = await loadManifests([
  ['./personal-inventory.js', 'personalInventoryManifest'],
  ['./sample-registry.js', 'sampleRegistryManifest']
]);

export const analysisModuleManifests = await loadManifests([
  ['./assay.js', 'assayManifest']
]);

export const sequenceModuleManifests = await loadManifests([
  ['./sequence-viewer.js', 'sequenceViewerManifest']
]);

export const utilityModuleManifests = await loadManifests([
  ['./workflow.js', 'workflowManagementManifest'],
  ['./settings.js', 'settingsManifest']
]);

export const rendererModuleManifests = [
  ...foundationModuleManifests,
  ...collaborationModuleManifests,
  ...inventoryModuleManifests,
  ...analysisModuleManifests,
  ...sequenceModuleManifests,
  ...utilityModuleManifests
];

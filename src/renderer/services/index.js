import { createModuleRegistry } from './module-registry.js';
import { createProtocolService } from './protocolService.js';
import { createNotebookService } from './notebookService.js';
import { createProjectService } from './projectService.js';
import { createInventoryService } from './inventoryService.js';
import { createAnalysisService } from './analysisService.js';
import { createSequenceService } from './sequenceService.js';
import { createUndoService } from './undoService.js';

export {
  createModuleRegistry,
  createProtocolService,
  createNotebookService,
  createProjectService,
  createInventoryService,
  createAnalysisService,
  createSequenceService,
  createUndoService
};

export function createRendererServices(registry, options = {}) {
  return {
    protocol: createProtocolService(registry, options.protocol || {}),
    notebook: createNotebookService(registry),
    project: createProjectService(registry),
    inventory: createInventoryService(registry),
    analysis: createAnalysisService(registry),
    sequence: createSequenceService(registry)
  };
}

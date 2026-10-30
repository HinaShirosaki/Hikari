import { createModuleRegistry } from './module-registry.js';
import { createProtocolService } from './protocolService.js';
import { createNotebookService } from './notebookService.js';
import { createProjectService } from './projectService.js';
import { createInventoryService } from './inventoryService.js';
import { createAnalysisService } from './analysisService.js';
import { createSequenceService } from '../modules/sequence-viewer/service.js';
import { createUndoService } from './undoService.js';
import { createUnsavedChangesService } from './unsavedChangesService.js';
import { createContextActionService } from './contextActionService.js';

export {
  createModuleRegistry,
  createProtocolService,
  createNotebookService,
  createProjectService,
  createInventoryService,
  createAnalysisService,
  createSequenceService,
  createUndoService,
  createUnsavedChangesService
};

export function createRendererServices(registry, options = {}) {
  return {
    contextActions: createContextActionService(registry),
    protocol: createProtocolService(registry, options.protocol || {}),
    notebook: createNotebookService(registry),
    project: createProjectService(registry, options.project || {}),
    inventory: createInventoryService(registry),
    analysis: createAnalysisService(registry),
    sequence: createSequenceService(registry)
  };
}

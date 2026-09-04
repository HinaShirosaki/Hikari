import { installProteinBuilderAssemblyActions } from './protein-builder/assembly-actions.js';
import { installProteinBuilderAssemblyDialog } from './protein-builder/assembly-dialog.js';
import { installProteinBuilderAssemblyState } from './protein-builder/assembly-state.js';
import { installProteinBuilderAddProteinDialog } from './protein-builder/add-protein-dialog.js';
import { installProteinBuilderBlockRendering } from './protein-builder/block-rendering.js';
import { createProteinBuilderContext } from './protein-builder/controller-context.js';
import { installProteinBuilderDnaRendering } from './protein-builder/dna-rendering.js';
import { installProteinBuilderEvents } from './protein-builder/events.js';
import { installProteinBuilderRowActions } from './protein-builder/row-actions.js';
import { installProteinBuilderWorkflowRendering } from './protein-builder/workflow-rendering.js';

export function createSequenceViewerProteinBuilderController(config = {}) {
  const ctx = createProteinBuilderContext(config);
  installProteinBuilderAddProteinDialog(ctx);
  installProteinBuilderDnaRendering(ctx);
  installProteinBuilderAssemblyState(ctx);
  installProteinBuilderAssemblyDialog(ctx);
  installProteinBuilderAssemblyActions(ctx);
  installProteinBuilderBlockRendering(ctx);
  installProteinBuilderWorkflowRendering(ctx);
  installProteinBuilderRowActions(ctx);
  installProteinBuilderEvents(ctx);

  ctx.resetRows();
  ctx.render();

  return {
    bindEvents: ctx.bindEvents,
    render: ctx.render
  };
}

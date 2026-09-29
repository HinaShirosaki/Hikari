import { installBlockchainAndMessages } from './blockchain-and-messages.js';
import { installChemicalDetailRendering } from './chemical-detail-rendering.js';
import { installChemicalDialog } from './dialog-controller.js';
import { installChemicalForm } from './chemical-form.js';
import { installChemicalListRendering } from './chemical-list-rendering.js';
import { createLabCommonInventoryContext } from './controller-context.js';
import { bindLabCommonInventoryEvents } from './events.js';
import { installImportFileParsing } from './import-file-parsing.js';
import { installImportFlow } from './import-flow.js';
import { installImportHeaderMapping } from './import-header-mapping.js';
import { installImportRecords } from './import-records.js';
import { installLocationCodeHelpers } from './location-codes.js';
import { installRenderAll } from './render-all.js';
import { installChemicalSqliteSync } from './sqlite-sync.js';

// Lab chemical inventory. Each install* adds its functions onto one shared
// ctx, and later installers call earlier ones through ctx, so keep this order
// (location codes and sync first, rendering and events last).
export function initLabCommonInventory(options = {}) {
  const ctx = createLabCommonInventoryContext(options);
  ctx.ensureLabInventoryShape();
  installLocationCodeHelpers(ctx);
  installChemicalSqliteSync(ctx);
  installBlockchainAndMessages(ctx);
  installImportFileParsing(ctx);
  installImportHeaderMapping(ctx);
  installImportRecords(ctx);
  installImportFlow(ctx);
  installChemicalDialog(ctx);
  installChemicalForm(ctx);
  installChemicalDetailRendering(ctx);
  installChemicalListRendering(ctx);
  installRenderAll(ctx);
  bindLabCommonInventoryEvents(ctx);
  return {
    renderAll: ctx.renderAll,
    renderLocationOptions: ctx.renderLocationOptions
  };
}

import { createPresentation } from "../../lib/i18n/presentation.js";
import "./localization.js";
const i18nUi = createPresentation("chemicals");
import { chemicalDisplayText, bindChemicalMessage, chemicalNotice } from './localization.js';
import { buildChemicalImportResultMarkup } from './import-presentation.js';

export function installBlockchainAndMessages(ctx) {
  const { createId, state } = ctx;
  const { chemicalImportStatus } = ctx.elements;

// "Blockchain" is an append-only change log: each block stores the previous
// block's hash, so an edited history shows a broken chain. The hash is a 32-bit
// string hash for change detection, not cryptographic tamper-proofing.
function simpleHash(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return `h${Math.abs(hash).toString(16)}`;
}

function appendBlock(action, payload) {
  const prev = state.labInventory.blocks[state.labInventory.blocks.length - 1];
  const block = {
    index: state.labInventory.blocks.length + 1,
    timestamp: new Date().toISOString(),
    action,
    prevHash: prev?.hash || 'GENESIS',
    payload
  };
  block.hash = simpleHash(JSON.stringify(block));
  state.labInventory.blocks.push(block);
}

// Queues an in-app message to every lab member with a Hikari email (except
// the sender). Messages live in state.messages; nothing is emailed.
function broadcastInventoryUpdate(chemical) {
  const recipients = Array.from(new Set(
    state.members
      .map((member) => member.hikariEmail)
      .filter((email) => email && email.trim())
  ));

  const from = state.settings.personalInfo.hikariEmail || 'system@hikari.local';
  recipients
    .filter((to) => to !== from)
    .forEach((to) => {
      state.messages.push({
        id: createId(),
        from,
        to,
        subject: '[Inventory Sync] Chemical Updated',
        body: `${chemical.name} (${chemical.casNumber}) updated.`,
        createdAt: new Date().toISOString(),
        readBy: [],
        type: 'inventory_sync',
        payload: {
          chemical
        }
      });
    });
}

function setChemicalImportStatus(message, tone = 'idle') {
  if (tone === 'error' && message) {
    chemicalNotice(message, { type: 'error' });
  }
  if (!chemicalImportStatus) {
    return;
  }
  const text = chemicalDisplayText(message);
  bindChemicalMessage(chemicalImportStatus, message);
  chemicalImportStatus.hidden = !text;
  chemicalImportStatus.dataset.status = tone;
}

function setChemicalImportResult(result, inference, fileName) {
  if (!chemicalImportStatus) return;
  chemicalImportStatus.removeAttribute?.('data-i18n');
  chemicalImportStatus.removeAttribute?.('data-i18n-params');
  i18nUi.setHtml(chemicalImportStatus, buildChemicalImportResultMarkup(result, inference, fileName));
  chemicalImportStatus.hidden = false;
  chemicalImportStatus.dataset.status = inference.llmError ? 'warning' : 'success';
}

  Object.assign(ctx, {
    simpleHash,
    appendBlock,
    broadcastInventoryUpdate,
    setChemicalImportStatus,
    setChemicalImportResult
  });
}

export function installBlockchainAndMessages(ctx) {
  const { createId, state } = ctx;
  const { chemicalImportStatus } = ctx.elements;

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
  if (!chemicalImportStatus) {
    return;
  }
  const text = String(message || '');
  chemicalImportStatus.textContent = text;
  chemicalImportStatus.hidden = !text;
  chemicalImportStatus.dataset.status = tone;
}

  Object.assign(ctx, {
    simpleHash,
    appendBlock,
    broadcastInventoryUpdate,
    setChemicalImportStatus
  });
}

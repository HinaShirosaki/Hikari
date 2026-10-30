import { createPresentation } from "../../lib/i18n/presentation.js";
import "./localization.js";
const i18nUi = createPresentation("dna");
import { normalizeTopology } from './shared.js';
import { positionFloatingUi } from './detail-feature-editing/feature-ranges.js';

export function createSequenceCursorMenuController(config = {}) {
  const elements = config.elements || {};
  const getSelectedRecord = config.getSelectedRecord || (() => null);
  const hideFeatureContextMenu = config.hideFeatureContextMenu || (() => {});
  const openSequenceEditDialog = config.openSequenceEditDialog || (() => false);
  const onSetSequenceOrigin = config.onSetSequenceOrigin || (async () => {});
  const setStatus = config.setStatus || (() => {});
  let activeContext = null;

  function clearContext() {
    activeContext = null;
  }

  function renderContextMenu(context, event) {
    const menu = elements.featureContextMenu;
    const record = context?.record;
    const boundary = context?.boundary;
    if (!menu || !record?.sequence?.length || !Number.isFinite(boundary)) return;
    hideFeatureContextMenu();
    activeContext = { record, boundary };
    const circular = normalizeTopology(record.topology) === 'circular';
    const atStart = boundary === 0 || boundary === record.sequence.length;
    i18nUi.setHtml(menu, `
      <button type="button" class="sequence-viewer-context-item" data-sequence-cursor-action="insert">${i18nUi.html("Insert Sequence…")}</button>
      ${circular ? `<button type="button" class="sequence-viewer-context-item" data-sequence-cursor-action="set-origin"${atStart ? ' disabled' : ''}>${i18nUi.html("Set Sequence Start Here")}</button>` : ''}
    `);
    menu.hidden = false;
    positionFloatingUi(menu, Number(event?.clientX) + 4, Number(event?.clientY) + 4);
  }

  async function applyAction(action) {
    const context = activeContext;
    if (!context || context.record !== getSelectedRecord()) {
      hideFeatureContextMenu();
      return;
    }
    const { boundary } = context;
    hideFeatureContextMenu();
    if (action === 'insert') {
      openSequenceEditDialog('insert', { range: { start: boundary, end: boundary } });
    } else if (action === 'set-origin') {
      // rotateCircularSequenceRecord rejects linear records and ignores the current start.
      try {
        await onSetSequenceOrigin(boundary);
      } catch (error) {
        setStatus((((((error?.message || i18nUi.text("Failed to change the sequence start.")))))), true);
      }
    }
  }

  return { clearContext, renderContextMenu, applyAction };
}

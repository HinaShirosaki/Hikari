import { createPresentation } from "../../lib/i18n/presentation.js";
import "./localization.js";
const i18nUi = createPresentation("dna");
import * as detailAlignment from './detail-alignment.js';
import { escapeHtml } from '../../lib/html.js';
import { cleanText } from './shared.js';
import { LIBRARY_STATUS_SAVED } from './runtime/config.js';
import { normalizeOrfStopCodonSelection } from './translation-style.js';

// Keeps the detail toolbar in step with the record on screen: enabled states,
// ORF / primer / restriction filters, alignment controls, and the
// protein-builder confirmation panel.
function createDetailControlSync({
  elements,
  state,
  ORF_FRAME_TOGGLES,
  normalizeOrfFrameFilter,
  getSelectedRecord,
  hasStoragePath,
  hasCloningDesignSource
} = {}) {
  function syncActionButtonsState() {
    const hasRecord = Boolean(getSelectedRecord()?.sequence?.length);
    if (elements.saveBtn) {
      // Only unsaved (temporary or not-yet-persisted) records need saving.
      const canSave = hasRecord && hasStoragePath() && state.activeEntryStatus !== LIBRARY_STATUS_SAVED;
      elements.saveBtn.hidden = !canSave;
      elements.saveBtn.disabled = !canSave;
    }
    if (elements.annotateBtn) {
      elements.annotateBtn.disabled = !hasRecord || !hasStoragePath() || Boolean(state.isAnnotating);
    }
    if (elements.alignmentOpenBtn) {
      elements.alignmentOpenBtn.disabled = !hasRecord;
    }
    if (elements.alignmentMenuBtn) {
      elements.alignmentMenuBtn.disabled = !hasRecord;
    }
    if (elements.orfMenuBtn) {
      elements.orfMenuBtn.disabled = !hasRecord;
    }
    if (elements.cutterMenuBtn) {
      elements.cutterMenuBtn.disabled = !hasRecord;
    }
    if (elements.cloningDesignBtn) {
      const canOpenCloningDesign = hasRecord && Boolean(hasCloningDesignSource());
      elements.cloningDesignBtn.hidden = !canOpenCloningDesign;
      elements.cloningDesignBtn.disabled = !canOpenCloningDesign;
    }
  }

  function syncAlignmentControlsState() {
    detailAlignment.syncAlignmentControlsState({
      elements,
      state,
      record: getSelectedRecord()
    });
  }

  function syncOrfToggleState() {
    const hasRecord = Boolean(getSelectedRecord()?.sequence?.length);
    const stopCodons = normalizeOrfStopCodonSelection(state.orfStopCodons);
    if (elements.orfToggle) {
      elements.orfToggle.checked = Boolean(state.orfViewEnabled);
      elements.orfToggle.disabled = !hasRecord;
    }
    if (elements.orfStopTagToggle) {
      elements.orfStopTagToggle.checked = Boolean(stopCodons.TAG);
      elements.orfStopTagToggle.disabled = !hasRecord;
    }
    if (elements.orfStopTaaToggle) {
      elements.orfStopTaaToggle.checked = Boolean(stopCodons.TAA);
      elements.orfStopTaaToggle.disabled = !hasRecord;
    }
    if (elements.orfStopTgaToggle) {
      elements.orfStopTgaToggle.checked = Boolean(stopCodons.TGA);
      elements.orfStopTgaToggle.disabled = !hasRecord;
    }
    const frameFilter = normalizeOrfFrameFilter(state.orfFrameFilter);
    for (const [frame, key] of ORF_FRAME_TOGGLES) {
      const toggle = elements[key];
      if (toggle) {
        toggle.checked = frameFilter[frame];
        toggle.disabled = !hasRecord;
      }
    }
  }

  function readOrfStopCodonsFromControls() {
    return normalizeOrfStopCodonSelection({
      TAG: Boolean(elements.orfStopTagToggle?.checked),
      TAA: Boolean(elements.orfStopTaaToggle?.checked),
      TGA: Boolean(elements.orfStopTgaToggle?.checked)
    });
  }

  function readOrfFrameFilterFromControls() {
    const result = {};
    for (const [frame, key] of ORF_FRAME_TOGGLES) {
      result[frame] = Boolean(elements[key]?.checked);
    }
    return result;
  }

  function getAlignmentHighlightSegments(record) {
    return detailAlignment.getAlignmentHighlightSegments(state, record);
  }

  // One shared flag, two toolbars: keep both boxes showing the same thing.
  function syncPrimersToggleState() {
    const checked = state.showPrimers !== false;
    if (elements.primersToggle) {
      elements.primersToggle.checked = checked;
    }
    if (elements.vectorBuilderPrimersToggle) {
      elements.vectorBuilderPrimersToggle.checked = checked;
    }
  }

  function syncRestrictionVendorToggleState() {
    if (elements.restrictionNebToggle) {
      elements.restrictionNebToggle.checked = Boolean(state.restrictionVendorFilter?.neb);
    }
    if (elements.restrictionThermoToggle) {
      elements.restrictionThermoToggle.checked = Boolean(state.restrictionVendorFilter?.thermo);
    }
  }

  function renderProteinBuilderConfirmation(record) {
    const confirmation = state.proteinBuilderConfirmation && typeof state.proteinBuilderConfirmation === 'object'
      ? state.proteinBuilderConfirmation
      : null;
    const isVisible = Boolean(confirmation && record?.sequence?.length);

    if (elements.proteinBuilderConfirmation) {
      elements.proteinBuilderConfirmation.hidden = !isVisible;
    }
    if (!elements.proteinBuilderConfirmationSummary) {
      return;
    }
    if (!isVisible) {
      i18nUi.setHtml(elements.proteinBuilderConfirmationSummary, `<p class="small-note">${i18nUi.html("Protein Builder review details will appear here.")}</p>`);
      return;
    }

    const summaryParts = [
      cleanText(confirmation?.recordName, 160)
        ? `<p><strong>${i18nUi.html("Reviewing:")}</strong> ${escapeHtml(cleanText(confirmation.recordName, 160))}</p>`
        : '',
      cleanText(confirmation?.constructName, 160)
        ? `<p><strong>${i18nUi.html("Insert:")}</strong> ${escapeHtml(cleanText(confirmation.constructName, 160))}</p>`
        : '',
      cleanText(confirmation?.backboneName, 160)
        ? `<p><strong>${i18nUi.html("Backbone:")}</strong> ${escapeHtml(cleanText(confirmation.backboneName, 160))}</p>`
        : '',
      Number.isFinite(Number(confirmation?.plasmidLength))
        ? `<p><strong>${i18nUi.html("Total Length:")}</strong> ${Math.max(0, Number(confirmation.plasmidLength)).toLocaleString()} bp</p>`
        : '',
      Number.isFinite(Number(confirmation?.insertLength))
        ? `<p><strong>${i18nUi.html("Insert DNA:")}</strong> ${Math.max(0, Number(confirmation.insertLength)).toLocaleString()} bp</p>`
        : '',
      cleanText(confirmation?.sourceLabel, 160)
        ? `<p><strong>${i18nUi.html("Backbone Source:")}</strong> ${escapeHtml(cleanText(confirmation.sourceLabel, 160))}</p>`
        : '',
      cleanText(confirmation?.assemblyStrategy, 120)
        ? `<p><strong>${i18nUi.html("Assembly Route:")}</strong> ${escapeHtml(cleanText(confirmation.assemblyStrategy, 120).replace(/[-_]+/g, ' '))}</p>`
        : '',
      Number.isFinite(Number(confirmation?.primerCount)) && Number(confirmation.primerCount) > 0
        ? `<p><strong>${i18nUi.html("Primer Plan:")}</strong> ${Math.max(0, Number(confirmation.primerCount)).toLocaleString()} ${i18nUi.html("primer")}${Number(confirmation.primerCount) === 1 ? '' : 's'} ${i18nUi.html("designed.")}</p>`
        : '',
      cleanText(confirmation?.notebookTitle, 220)
        ? `<p><strong>${i18nUi.html("Notebook Page:")}</strong> ${escapeHtml(cleanText(confirmation.notebookTitle, 220))}</p>`
        : '',
      `<p class="small-note">${i18nUi.html("Review the sequence and annotations before confirming this Protein Builder construct.")}</p>`
    ].filter(Boolean);
    i18nUi.setHtml(elements.proteinBuilderConfirmationSummary, summaryParts.join(''));
  }

  return {
    syncActionButtonsState,
    syncAlignmentControlsState,
    syncOrfToggleState,
    readOrfStopCodonsFromControls,
    readOrfFrameFilterFromControls,
    getAlignmentHighlightSegments,
    syncPrimersToggleState,
    syncRestrictionVendorToggleState,
    renderProteinBuilderConfirmation
  };
}

export { createDetailControlSync };

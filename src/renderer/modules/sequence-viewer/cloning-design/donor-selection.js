import { escapeHtml } from '../../../lib/html.js';
import { asArray } from '../../../lib/normalize.js';
import { cleanText, normalizeSequenceText } from '../shared.js';
import { parseInputRecords } from '../parsing.js';

// The donor plasmid a gene is amplified from. The library only keeps GenBank
// text until an entry is opened, so the hydrated record is held here.
function createDonorSelection({
  state = {},
  elements = {},
  getBridge = () => null,
  getStoragePath = () => '',
  getDesignState = () => ({}),
  setStatus = () => {},
  syncControls = () => {},
  render = () => {}
} = {}) {
  let donorRecord = null;
  // Designing while the donor is still loading would template the PCR off this
  // record instead, with the dropdown already showing the donor, so the run
  // button stays down until the read settles.
  let donorHydrationPending = false;
  // Every selection owns a token. Late reads from a previous selection are
  // ignored so they cannot replace the current donor or clear its loading state.
  let donorHydrationRequestId = 0;

  function getDonorEntries() {
    return asArray(state.libraryEntries)
      .map((entry) => ({ id: cleanText(entry?.id, 200), name: cleanText(entry?.name, 160) || 'sequence' }))
      .filter((entry) => entry.id);
  }

  async function hydrateDonor(entryId) {
    const safeId = cleanText(entryId, 200);
    if (!safeId) {
      return null;
    }
    if (donorRecord?.id === safeId) {
      return donorRecord;
    }
    const bridge = getBridge();
    const storagePath = getStoragePath();
    if (!bridge?.sequenceLibraryGet || !storagePath) {
      throw new Error('Sequence library storage is unavailable.');
    }
    const response = await bridge.sequenceLibraryGet({ storagePath, id: safeId, includeGbk: true });
    if (!response?.ok || !response?.entry) {
      throw new Error(response?.error || 'Donor plasmid could not be loaded.');
    }
    const parsed = parseInputRecords(String(response.gbkText || ''));
    const parsedRecord = asArray(parsed?.records)[0];
    const sequence = normalizeSequenceText(parsedRecord?.sequence || '');
    if (!sequence.length) {
      throw new Error('That library entry has no sequence to amplify from.');
    }
    return {
      id: safeId,
      name: cleanText(parsedRecord?.name || response.entry?.name, 160) || 'Donor plasmid',
      topology: cleanText(parsedRecord?.topology, 40) || 'circular',
      sequence
    };
  }

  async function selectDonorEntry(entryId, { silent = false } = {}) {
    const designState = getDesignState();
    const safeId = cleanText(entryId, 200);
    const requestId = donorHydrationRequestId + 1;
    donorHydrationRequestId = requestId;
    designState.donorEntryId = safeId;
    designState.displayPlan = null;
    donorHydrationPending = Boolean(safeId);
    if (!safeId) {
      donorRecord = null;
    }
    syncControls();
    try {
      const hydrated = await hydrateDonor(safeId);
      if (requestId !== donorHydrationRequestId) {
        return;
      }
      donorRecord = hydrated;
      if (!silent) {
        setStatus(safeId
          ? `Insert will be amplified from ${donorRecord?.name || 'the donor plasmid'}.`
          : 'Insert will be amplified from this record.');
      }
    } catch (error) {
      if (requestId !== donorHydrationRequestId) {
        return;
      }
      designState.donorEntryId = '';
      donorRecord = null;
      setStatus(error?.message || 'Donor plasmid could not be loaded.', true);
    } finally {
      if (requestId === donorHydrationRequestId) {
        donorHydrationPending = false;
        render();
      }
    }
  }

  function getActiveDonor() {
    const designState = getDesignState();
    return designState.donorEntryId && donorRecord?.id === designState.donorEntryId ? donorRecord : null;
  }

  function renderDonorPanel() {
    const designState = getDesignState();
    if (elements.cloningDesignDonorSelect) {
      const entries = getDonorEntries();
      elements.cloningDesignDonorSelect.innerHTML = [
        '<option value="">This record</option>',
        ...entries.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.name)}</option>`)
      ].join('');
      elements.cloningDesignDonorSelect.value = cleanText(designState.donorEntryId, 200);
    }
    if (elements.cloningDesignDonorNote) {
      const donor = getActiveDonor();
      elements.cloningDesignDonorNote.textContent = donor
        ? `Insert is amplified from ${donor.name} (${donor.sequence.length.toLocaleString()} bp); primer specificity is checked against the whole donor.`
        : 'The insert is amplified from this record.';
    }
  }

  // Switching source records abandons any in-flight donor read.
  function resetDonor() {
    donorHydrationRequestId += 1;
    donorHydrationPending = false;
    donorRecord = null;
  }

  return {
    getDonorEntries,
    resetDonor,
    hydrateDonor,
    selectDonorEntry,
    getActiveDonor,
    renderDonorPanel,
    isDonorHydrationPending: () => donorHydrationPending
  };
}

export { createDonorSelection };
